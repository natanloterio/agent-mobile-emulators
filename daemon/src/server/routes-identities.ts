import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { BRAND } from '../brand.js';
import { CONFIG, currentBaseAvd } from '../config.js';
import { BASE_IDENTITY_ID, getFleetIdentity, getIdentity, listIdentities, setIdentityFlags, setIdentityState, upsertIdentity, type IdentityRow } from '../db/identities.js';
import { openMissionFor } from '../db/missions.js';
import type { Adb } from '../device/adb.js';
import { findRunningAvd } from '../device/running-avd.js';
import { readBasePrep, readTargetVersion } from '../db/base-settings.js';
import type { ProbeResult } from '../device/probe.js';
import { killEmulator, loadSnapshot, saveSnapshot } from '../fleet/emulator.js';
import type { Route, RouteCtx } from './api.js';
import { CredsBody, issues } from './routes-credentials.js';
import { buildSnapshot, isRestoreUnsafe } from './snapshot.js';

/** Rotas do ciclo de vida da identidade (spec inc. 5 §3.2, Frente B). `/control` e `/input` ficam para outra rota. */
export interface IdentityOps {
  readonly adb: Pick<Adb, 'devices' | 'emu' | 'trimCaches'> & Partial<Pick<Adb, 'versionName'>>;
  /** Clona o AVD-base no nome dado. */
  readonly clone: (avdName: string) => Promise<unknown>;
  readonly deleteAvd: (avdName: string) => Promise<void>;
  /** Sobe o emulador (se preciso) e espera o boot; devolve a identidade, possivelmente com portas novas. */
  readonly boot: (identity: IdentityRow, opts: { window: boolean }) => Promise<IdentityRow>;
  readonly leasePorts: (db: DatabaseSync) => Promise<{ consolePort: number; mcpHostPort: number }>;
  readonly ensureReady: (db: DatabaseSync, identity: IdentityRow) => Promise<ProbeResult>;
  readonly disk?: { invalidate(avdName: string): void };
  /** Esquece/mata o processo do emulador se foi o daemon que o subiu. */
  readonly supervisor?: { stop(id: string): void };
  /** Lista de identidades mudou de forma que vídeo/miniatura precisam recomeçar (boot, descarte). */
  readonly onIdentitiesChanged?: () => void;
  /**
   * Apaga a conta do app alvo no device (ex.: `pm clear`). Chamado uma vez, no primeiro boot de um clone ainda sem login:
   * o AVD-base desta máquina é o da conta1, logado, e a identidade nova não pode nascer com a sessão de outra (spec §4.1).
   */
  readonly clearAccount?: (identity: IdentityRow) => Promise<void>;
  /** Destrava tela/armazenamento com o PIN da identidade; lança se estiver bloqueado e não houver PIN (ou se for recusado). */
  readonly unlock?: (identity: IdentityRow) => Promise<unknown>;
  /** Define o PIN no device (clone novo nasce da base sem credencial). */
  readonly setPin?: (identity: IdentityRow, pin: string) => Promise<void>;
  /** PIN aplicado a identidade nova quando o corpo não traz um (TAPFLOCK_DEFAULT_PIN). */
  readonly defaultPin?: string | null;
  /** Login fixo do Instagram (fleet/login.ts) com as credenciais que o main do Electron decifrou. */
  readonly login?: (identity: IdentityRow, creds: { username: string; password: string }) => Promise<{ outcome: 'logged-in' | 'already-logged-in' | 'needs-human'; detail: string }>;
  /** Lê a tela do Instagram antes do login-done: "Login feito" só vale com a sessão de pé (spec guia). */
  readonly checkSession?: (identity: IdentityRow) => Promise<{ state: 'logged-in' | 'logged-out' | 'blocked' | 'unknown'; detail: string }>;
  /** Credencial do app alvo guardada no cofre do daemon; usada quando o login chega sem corpo. */
  readonly credentials?: (id: string) => Promise<{ username: string; password: string } | null>;
  readonly now?: () => Date; readonly uuid?: () => string;
  readonly baseAvd?: string; readonly snapshotName?: string;
  readonly killSleep?: (ms: number) => Promise<void>;
}

const NAME = /^[A-Za-z0-9_]{1,32}$/;
const HANDLE = /^@?[A-Za-z0-9._]{1,30}$/;
const NO_ACCOUNT = 'sem conta';
const AVD_PREFIX = `${BRAND}_`;
const ROUTE = /^\/identities(?:\/([^/]+)\/([a-z-]+))?$/;

const awaitingLogin = (id: IdentityRow) => id.state === 'provisioned' || id.state === 'blank' || id.handle === NO_ACCOUNT;

export const normalizeHandle = (h: string): string | null => (HANDLE.test(h) ? `@${h.replace(/^@/, '')}` : null);

const PinSchema = z.string().regex(/^\d{4,16}$/, 'PIN: só dígitos, 4 a 16');
const CreateBody = z.object({ name: z.string().regex(NAME, 'nome: [A-Za-z0-9_], até 32').optional(), handle: z.string().optional(), pin: PinSchema.optional() });
const PinBody = z.object({ pin: PinSchema });
const BootBody = z.object({ window: z.boolean().optional() });
const LoginBody = z.object({ handle: z.string() });
const PauseBody = z.object({ paused: z.boolean() });
const BanBody = z.object({ reason: z.string().trim().min(1, 'motivo obrigatório').max(500) });
const RestoreBody = z.object({ confirm: z.boolean().optional() });

const errMsg = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 300);

type Action = (ctx: RouteCtx, id: IdentityRow) => Promise<void>;

export function createIdentityRoutes(ops: IdentityOps): { route: Route; settle(): Promise<void>; booting(): ReadonlySet<string> } {
  const clock = () => ops.now?.() ?? new Date();
  const now = () => clock().toISOString();
  const uuid = ops.uuid ?? randomUUID;
  // Relido a cada uso: a base criada com o daemon rodando (guia do celular-base) vale sem reiniciar.
  const base = () => ops.baseAvd ?? currentBaseAvd().name;
  const snap = ops.snapshotName ?? CONFIG.avd.snapshotName;
  const pending = new Set<Promise<void>>();
  /** Identidades com o emulador subindo agora (boot em segundo plano); vai no snapshot para a tela mostrar. */
  const booting = new Set<string>();
  let provisioning: Promise<unknown> = Promise.resolve();

  const background = (job: () => Promise<void>) => {
    const p = job().catch((e: unknown) => console.error('[identidades] tarefa em segundo plano falhou:', e)).finally(() => { pending.delete(p); });
    pending.add(p);
  };
  const row = (ctx: RouteCtx, id: string) => buildSnapshot(ctx.db, ctx.isKilled()).identities.find((i) => i.id === id) ?? null;
  const online = async (id: IdentityRow) => (await ops.adb.devices()).includes(id.serial);
  const parse = async <T>(ctx: RouteCtx, schema: z.ZodType<T>): Promise<T | null> => {
    const r = schema.safeParse((await ctx.body()) ?? {});
    if (!r.success) { ctx.send(400, { error: issues(r.error) }); return null; }
    return r.data;
  };
  const done = (ctx: RouteCtx, id: string, code = 200) => { ctx.send(code, row(ctx, id)); ctx.broadcast(); };
  /** Falha de device: grava em last_error (mantém o estado) e responde 500. */
  const fail = (ctx: RouteCtx, id: IdentityRow, e: unknown) => {
    const cur = getIdentity(ctx.db, id.id) ?? id;
    setIdentityState(ctx.db, id.id, cur.state, { lastError: errMsg(e) });
    ctx.send(500, { error: errMsg(e) }); ctx.broadcast();
  };

  const freeName = (db: DatabaseSync) => {
    const taken = new Set(listIdentities(db).flatMap((i) => [i.id, i.name]));
    let n = 1; while (taken.has(`conta${n}`)) n += 1;
    return `conta${n}`;
  };

  async function create(ctx: RouteCtx): Promise<void> {
    const body = await parse(ctx, CreateBody); if (!body) return;
    const handle = body.handle === undefined ? NO_ACCOUNT : normalizeHandle(body.handle);
    if (handle === null) return ctx.send(400, { error: 'handle inválido' });
    // Serializado: lease de porta e escolha de nome não podem correr em paralelo.
    if (body.name === BASE_IDENTITY_ID) return ctx.send(400, { error: `nome ${BASE_IDENTITY_ID} é reservado ao celular-base` });
    // Base sendo montada (avdmanager escrevendo, emulador subindo, missão rodando): clonar agora copiaria disco pela metade.
    if (['running', 'needs-google', 'needs-human'].includes(readBasePrep(ctx.db).state)) return ctx.send(409, { error: 'o celular-base ainda está sendo preparado' });
    const job = provisioning.then(async () => {
      const name = body.name ?? freeName(ctx.db);
      if (getIdentity(ctx.db, name)) return ctx.send(409, { error: `identidade ${name} já existe` });
      const avdName = `${AVD_PREFIX}${name}`;
      // Copiar o qcow2 de um emulador vivo gera clone inconsistente: o AVD-base precisa estar parado.
      const devices = await ops.adb.devices();
      const baseName = base();
      const busy = listIdentities(ctx.db).find((i) => i.avdName === baseName && devices.includes(i.serial))
        ?? await findRunningAvd(ops.adb, devices, baseName);
      if (busy) return ctx.send(409, { error: `AVD-base ${baseName} em uso (${busy.serial}): pare esse emulador antes de provisionar` });
      const ports = await ops.leasePorts(ctx.db);
      try { await ops.clone(avdName); } catch (e) { return ctx.send(500, { error: `clone do AVD falhou: ${errMsg(e)}` }); }
      upsertIdentity(ctx.db, {
        id: name, name, handle, avdName, serial: `emulator-${ports.consolePort}`, consolePort: ports.consolePort, mcpHostPort: ports.mcpHostPort,
        mcpToken: uuid(), deviceSlug: name, appPackage: CONFIG.targetApp.package, appVersionName: readTargetVersion(ctx.db), state: 'provisioned',
      });
      // PIN pedido para a identidade: aplicado ao device no primeiro boot (o clone nasce sem credencial).
      const pin = body.pin ?? ops.defaultPin ?? null;
      if (pin) setIdentityFlags(ctx.db, name, { lockPin: pin });
      done(ctx, name, 201);
    });
    provisioning = job.catch(() => undefined);
    await job;
  }

  const boot: Action = async (ctx, id) => {
    const body = await parse(ctx, BootBody); if (!body) return;
    if (id.state === 'banned' || id.discardedAt) return ctx.send(409, { error: `identidade ${id.state}${id.discardedAt ? ' e descartada' : ''}` });
    if (booting.has(id.id)) return ctx.send(409, { error: 'identidade já está ligando' });
    // O boot leva 1–2 min em segundo plano: sem isto a tela seguia em "offline", sem sinal de que algo acontecia.
    booting.add(id.id);
    ctx.send(202, { booting: true });
    ctx.broadcast();
    background(async () => {
      try {
        const booted = await ops.boot(id, { window: body.window ?? false });
        const cur = getIdentity(ctx.db, id.id) ?? booted;
        // Reboot com credencial deixa o armazenamento travado (Direct Boot): destrava com o PIN da identidade.
        await ops.unlock?.(cur);
        // Sem login ainda (inclusive após um boot que falhou e deixou 'offline'): volta a 'provisioned' sem sonda — a sonda não
        // olha sessão e marcaria 'idle' uma identidade sem conta. As demais são sondadas a cada subida (spec §4.1).
        if (awaitingLogin(cur) && ops.clearAccount && !cur.accountClearedAt) {
          await ops.clearAccount(cur);
          if (cur.lockPin && ops.setPin) await ops.setPin(cur, cur.lockPin);
          setIdentityFlags(ctx.db, id.id, { accountClearedAt: now() });
        }
        if (awaitingLogin(cur)) setIdentityState(ctx.db, id.id, 'provisioned', { lastError: null });
        else await ops.ensureReady(ctx.db, cur);
        ops.onIdentitiesChanged?.();
      } catch (e) {
        setIdentityState(ctx.db, id.id, 'offline', { lastError: errMsg(e) });
      } finally { booting.delete(id.id); }
      ctx.broadcast();
    });
  };

  const loginDone: Action = async (ctx, id) => {
    const body = await parse(ctx, LoginBody); if (!body) return;
    const handle = normalizeHandle(body.handle);
    if (!handle) return ctx.send(400, { error: 'handle inválido' });
    if (id.state === 'running' || id.state === 'banned' || id.discardedAt) return ctx.send(409, { error: `login-done indisponível em ${id.state}` });
    // Com o emulador de pé, confere a tela antes de acreditar: marcar logado com o Instagram na tela de login fazia o
    // primeiro objetivo parar em needs-human. Desligado não há o que ler, e segue como antes.
    if (ops.checkSession && (await online(id))) {
      let session: Awaited<ReturnType<NonNullable<IdentityOps['checkSession']>>>;
      try { session = await ops.checkSession(id); }
      catch (e) { return ctx.send(409, { error: `não deu para conferir o login no celular: ${errMsg(e)}` }); }
      if (session.state === 'logged-out') return ctx.send(409, { error: 'o Instagram ainda está na tela de login: entre na conta no celular e tente de novo' });
      if (session.state === 'blocked') return ctx.send(409, { error: `o Instagram pediu uma verificação: ${session.detail}` });
      if (session.state === 'unknown') return ctx.send(409, { error: 'o Instagram não abriu no celular: abra o app, entre na conta e tente de novo' });
    }
    setIdentityFlags(ctx.db, id.id, { handle });
    try {
      await saveSnapshot(ops.adb, id.serial, snap);
      setIdentityState(ctx.db, id.id, 'logged-in', { lastError: null, snapshotTakenAt: now() });
    } catch (e) {
      setIdentityState(ctx.db, id.id, 'logged-in', { lastError: `snapshot após login falhou: ${errMsg(e)}` });
    }
    done(ctx, id.id);
  };

  const pause: Action = async (ctx, id) => {
    const body = await parse(ctx, PauseBody); if (!body) return;
    setIdentityFlags(ctx.db, id.id, { paused: body.paused });
    done(ctx, id.id);
  };

  const resolve: Action = async (ctx, id) => {
    if (id.state !== 'needs-human') return ctx.send(409, { error: `só de needs-human (está em ${id.state})` });
    setIdentityState(ctx.db, id.id, 'idle', { lastError: null });
    done(ctx, id.id);
  };

  const ban: Action = async (ctx, id) => {
    const body = await parse(ctx, BanBody); if (!body) return;
    setIdentityState(ctx.db, id.id, 'banned', { bannedReason: body.reason });
    setIdentityFlags(ctx.db, id.id, { bannedAt: now() });
    done(ctx, id.id);
  };

  /**
   * Desliga o emulador sem descartar nada (botão "Desligar"): `adb emu kill` fecha limpo e grava o disco. Recusa com
   * trabalho em andamento (objetivo ou missão rodando) e durante o boot; o ciclo de vida vai para offline sem erro.
   */
  const shutdown: Action = async (ctx, id) => {
    if (id.state === 'running') return ctx.send(409, { error: 'identidade rodando um objetivo' });
    if (openMissionFor(ctx.db, id.id)?.state === 'running') return ctx.send(409, { error: 'identidade em missão; pause a missão antes' });
    if (booting.has(id.id)) return ctx.send(409, { error: 'identidade já está ligando' });
    if (!(await online(id))) return ctx.send(409, { error: 'emulador fora do adb: dê boot antes' });
    try { await killEmulator(ops.adb, id.serial, { sleep: ops.killSleep }); } catch (e) { return fail(ctx, id, e); }
    ops.supervisor?.stop(id.id);
    // needs-human continua: desligar não resolve o que pediu gente (a missão segue esperando).
    if (id.state !== 'needs-human' && id.state !== 'banned') setIdentityState(ctx.db, id.id, 'offline', { lastError: null });
    ops.onIdentitiesChanged?.();
    done(ctx, id.id);
  };

  const discard: Action = async (ctx, id) => {
    if (id.state !== 'banned') return ctx.send(409, { error: 'só identidade banida pode ser descartada' });
    if (id.discardedAt) return ctx.send(409, { error: 'identidade já descartada' });
    if (id.avdName === base()) return ctx.send(409, { error: `${id.avdName} é o AVD-base; não é descartável` });
    try {
      if (await online(id)) await killEmulator(ops.adb, id.serial, { sleep: ops.killSleep });
      ops.supervisor?.stop(id.id);
      await ops.deleteAvd(id.avdName);
    } catch (e) { return fail(ctx, id, e); }
    setIdentityFlags(ctx.db, id.id, { discardedAt: now(), diskBytes: 0 });
    ops.disk?.invalidate(id.avdName);
    ops.onIdentitiesChanged?.();
    done(ctx, id.id);
  };

  /** Espera o serial reaparecer como `device` no adb (até ~60 s); depois a sonda decide. */
  async function waitBack(serial: string): Promise<void> {
    const sleep = ops.killSleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    await sleep(1000);
    for (let k = 0; k < 60 && !(await ops.adb.devices().catch(() => [] as readonly string[])).includes(serial); k++) await sleep(1000);
  }

  /** Tarefa `todo`/`running` desta identidade (ex.: esperando o start escalonado): restore/re-baseline agora furariam a verificação. */
  const hasPendingTask = (db: DatabaseSync, identityId: string): boolean =>
    !!db.prepare("select 1 from task t join goal g on g.id = t.goal_id where t.identity_id=? and t.state in ('todo','running') and g.state='running' limit 1").get(identityId);

  const restore: Action = async (ctx, id) => {
    const body = await parse(ctx, RestoreBody); if (!body) return;
    if (id.state === 'banned' || id.state === 'running' || id.discardedAt) return ctx.send(409, { error: `restore indisponível em ${id.state}` });
    if (hasPendingTask(ctx.db, id.id)) return ctx.send(409, { error: 'identidade com tarefa pendente no objetivo em curso' });
    if (!id.snapshotTakenAt) return ctx.send(409, { error: 'identidade sem snapshot' });
    if (isRestoreUnsafe(id.snapshotTakenAt, clock().getTime()) && !body.confirm) return ctx.send(409, { error: 'restore-unsafe: confirme' });
    if (!(await online(id))) return ctx.send(409, { error: 'emulador fora do adb: dê boot antes' });
    try { await loadSnapshot(ops.adb, id.serial, snap); } catch (e) { return fail(ctx, id, e); }
    setIdentityState(ctx.db, id.id, 'restored', { lastError: null });
    done(ctx, id.id);
    // Restaurar sempre seguido de verificação antes de qualquer tarefa; falha vira needs-human, nunca re-login automático (spec §4.1).
    background(async () => {
      // O snapshot load derruba o adb do device por alguns segundos (medido 2026-09-26): sondar antes dá "device offline" falso.
      await waitBack(id.serial);
      const cur = getIdentity(ctx.db, id.id) ?? id;
      const probe = await ops.ensureReady(ctx.db, cur);
      if (!probe.ready) setIdentityState(ctx.db, id.id, 'needs-human', { lastError: `sessão inválida após restore: ${probe.details.join(' · ') || probe.failureClass}` });
      ctx.broadcast();
    });
  };

  const rebaseline: Action = async (ctx, id) => {
    if (id.state === 'banned' || id.state === 'running' || id.discardedAt) return ctx.send(409, { error: `re-baseline indisponível em ${id.state}` });
    if (hasPendingTask(ctx.db, id.id)) return ctx.send(409, { error: 'identidade com tarefa pendente no objetivo em curso' });
    if (!(await online(id))) return ctx.send(409, { error: 'emulador fora do adb: dê boot antes' });
    try {
      await ops.adb.trimCaches(id.serial);
      await saveSnapshot(ops.adb, id.serial, snap);
    } catch (e) { return fail(ctx, id, e); }
    setIdentityState(ctx.db, id.id, id.state, { lastError: null, snapshotTakenAt: now() });
    ops.disk?.invalidate(id.avdName);
    done(ctx, id.id);
  };

  /**
   * O app alvo se atualizou sozinho (a sonda acusa versionName diferente): aceitar a versão instalada como a desta
   * identidade, em vez de ela ficar fora da frota sem nada a fazer na tela.
   */
  const acceptVersion: Action = async (ctx, id) => {
    if (id.state === 'banned' || id.state === 'running' || id.discardedAt) return ctx.send(409, { error: `identidade ${id.state}` });
    // Sem login ainda: a sonda passando a marcaria pronta para a frota sem conta (mesma regra do boot).
    if (awaitingLogin(id)) return ctx.send(409, { error: `login-done indisponível em ${id.state}` });
    if (hasPendingTask(ctx.db, id.id)) return ctx.send(409, { error: 'identidade com tarefa pendente no objetivo em curso' });
    if (openMissionFor(ctx.db, id.id)) return ctx.send(409, { error: 'identidade em missão; pause a missão antes' });
    if (!(await online(id))) return ctx.send(409, { error: 'emulador fora do adb: dê boot antes' });
    let installed: string | null;
    try { installed = (await ops.adb.versionName?.(id.serial, id.appPackage)) ?? null; } catch (e) { return fail(ctx, id, e); }
    if (!installed) return ctx.send(409, { error: `app ${id.appPackage} não está instalado no aparelho` });
    setIdentityFlags(ctx.db, id.id, { appVersionName: installed });
    // O ensureReady não grava os sinais (só a sonda da frota grava): sem isto o botão seguiria na tela até a próxima.
    const probe = await ops.ensureReady(ctx.db, getIdentity(ctx.db, id.id)!);
    setIdentityFlags(ctx.db, id.id, { lastSignals: probe.signals });
    done(ctx, id.id);
  };

  /** Registra o PIN de uma identidade existente. Com o device no adb, só grava se o PIN destravar de fato (evita gastar tentativas depois). */
  const pin: Action = async (ctx, id) => {
    const body = await parse(ctx, PinBody); if (!body) return;
    if (await online(id)) {
      try { await ops.unlock?.({ ...id, lockPin: body.pin }); }
      catch (e) { return ctx.send(409, { error: errMsg(e) }); }
    }
    setIdentityFlags(ctx.db, id.id, { lockPin: body.pin });
    done(ctx, id.id);
  };

  /**
   * Login pelo daemon (spec login-deterministico): uma tentativa, síncrona. A senha só existe nesta chamada: não vai para o banco,
   * log nem resposta; erro de infra sai com a senha trocada por *** e o estado anterior restaurado.
   */
  const login: Action = async (ctx, id) => {
    if (!ops.login) return ctx.send(404, { error: 'login pelo daemon indisponível' });
    const raw = await ctx.body();
    const empty = !!raw && typeof raw === 'object' && Object.keys(raw as object).length === 0;
    let body: { username: string; password: string } | null;
    if (empty) {
      body = (await ops.credentials?.(id.id)) ?? null;
      if (!body) return ctx.send(409, { error: 'sem credenciais salvas para esta identidade' });
    } else {
      body = await parse(ctx, CredsBody); if (!body) return;
    }
    if (openMissionFor(ctx.db, id.id)?.state === 'running') return ctx.send(409, { error: 'identidade em missão; pause a missão antes' });
    if (id.state === 'running' || id.state === 'banned' || id.discardedAt || id.controlled) return ctx.send(409, { error: `login indisponível em ${id.controlled ? 'controle humano' : id.state}` });
    if (!(await online(id))) return ctx.send(409, { error: 'emulador fora do adb: dê boot antes' });
    const prev = id.state;
    const scrub = (s: string) => s.split(body.password).join('***');
    let r: { outcome: 'logged-in' | 'already-logged-in' | 'needs-human'; detail: string };
    try { r = await ops.login(id, { username: body.username, password: body.password }); }
    catch (e) { setIdentityState(ctx.db, id.id, prev); ctx.broadcast(); return ctx.send(502, { error: scrub(errMsg(e)) }); }
    const detail = scrub(r.detail);
    if (r.outcome === 'needs-human') setIdentityState(ctx.db, id.id, 'needs-human', { lastError: detail });
    else {
      const handle = id.handle === NO_ACCOUNT ? normalizeHandle(body.username) : null;
      if (handle) setIdentityFlags(ctx.db, id.id, { handle });
      try { await saveSnapshot(ops.adb, id.serial, snap); setIdentityState(ctx.db, id.id, 'logged-in', { lastError: null, snapshotTakenAt: now() }); }
      catch (e) { setIdentityState(ctx.db, id.id, 'logged-in', { lastError: `snapshot após login falhou: ${errMsg(e)}` }); }
    }
    ctx.broadcast();
    ctx.send(200, { outcome: r.outcome, detail });
  };

  const actions: Readonly<Record<string, Action>> = { login, pin, boot, 'login-done': loginDone, pause, resolve, ban, discard, restore, rebaseline, 'accept-version': acceptVersion, shutdown };

  const route: Route = async (ctx) => {
    if (ctx.method !== 'POST') return false;
    const m = ROUTE.exec(ctx.url.pathname);
    if (!m) return false;
    const [, rawId, action] = m;
    if (!rawId) { await create(ctx); return true; }
    const act = actions[action];
    if (!act) return false; // /control, /input: Frente C
    const id = getFleetIdentity(ctx.db, decodeURIComponent(rawId));
    if (!id) { ctx.send(404, { error: 'identidade desconhecida' }); return true; }
    await act(ctx, id);
    return true;
  };

  return { route, settle: async () => { while (pending.size) await Promise.all([...pending]); }, booting: (): ReadonlySet<string> => booting };
}
