import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { CONFIG } from '../config.js';
import { getIdentity, listIdentities, setIdentityFlags, setIdentityState, upsertIdentity, type IdentityRow } from '../db/identities.js';
import type { Adb } from '../device/adb.js';
import type { ProbeResult } from '../device/probe.js';
import { killEmulator, loadSnapshot, saveSnapshot } from '../fleet/emulator.js';
import type { Route, RouteCtx } from './api.js';
import { buildSnapshot, isRestoreUnsafe } from './snapshot.js';

/** Rotas do ciclo de vida da identidade (spec inc. 5 §3.2, Frente B). `/control` e `/input` ficam para outra rota. */
export interface IdentityOps {
  readonly adb: Pick<Adb, 'devices' | 'emu' | 'trimCaches'>;
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
  /** Usuário Android travado por credencial após o boot (Direct Boot, `RUNNING_LOCKED`): ninguém opera o device sem o PIN. */
  readonly userLocked?: (identity: IdentityRow) => Promise<boolean>;
  readonly now?: () => Date; readonly uuid?: () => string;
  readonly baseAvd?: string; readonly snapshotName?: string;
  readonly killSleep?: (ms: number) => Promise<void>;
}

const NAME = /^[A-Za-z0-9_]{1,32}$/;
const HANDLE = /^@?[A-Za-z0-9._]{1,30}$/;
const NO_ACCOUNT = 'sem conta';
const AVD_PREFIX = 'enxame_';
const ROUTE = /^\/identities(?:\/([^/]+)\/([a-z-]+))?$/;

const awaitingLogin = (id: IdentityRow) => id.state === 'provisioned' || id.state === 'blank' || id.handle === NO_ACCOUNT;

export const normalizeHandle = (h: string): string | null => (HANDLE.test(h) ? `@${h.replace(/^@/, '')}` : null);

const CreateBody = z.object({ name: z.string().regex(NAME, 'nome: [A-Za-z0-9_], até 32').optional(), handle: z.string().optional() });
const BootBody = z.object({ window: z.boolean().optional() });
const LoginBody = z.object({ handle: z.string() });
const PauseBody = z.object({ paused: z.boolean() });
const BanBody = z.object({ reason: z.string().trim().min(1, 'motivo obrigatório').max(500) });
const RestoreBody = z.object({ confirm: z.boolean().optional() });

const errMsg = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 300);
const issues = (e: z.ZodError) => e.issues.map((i) => i.message).join('; ');

type Action = (ctx: RouteCtx, id: IdentityRow) => Promise<void>;

export function createIdentityRoutes(ops: IdentityOps): { route: Route; settle(): Promise<void> } {
  const clock = () => ops.now?.() ?? new Date();
  const now = () => clock().toISOString();
  const uuid = ops.uuid ?? randomUUID;
  const base = ops.baseAvd ?? CONFIG.avd.base;
  const snap = ops.snapshotName ?? CONFIG.avd.snapshotName;
  const pending = new Set<Promise<void>>();
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
    const job = provisioning.then(async () => {
      const name = body.name ?? freeName(ctx.db);
      if (getIdentity(ctx.db, name)) return ctx.send(409, { error: `identidade ${name} já existe` });
      const avdName = `${AVD_PREFIX}${name}`;
      // Copiar o qcow2 de um emulador vivo gera clone inconsistente: o AVD-base precisa estar parado.
      const devices = await ops.adb.devices();
      const busy = listIdentities(ctx.db).find((i) => i.avdName === base && devices.includes(i.serial))
        ?? await runningAvd(devices, base);
      if (busy) return ctx.send(409, { error: `AVD-base ${base} em uso (${busy.serial}): pare esse emulador antes de provisionar` });
      const ports = await ops.leasePorts(ctx.db);
      try { await ops.clone(avdName); } catch (e) { return ctx.send(500, { error: `clone do AVD falhou: ${errMsg(e)}` }); }
      upsertIdentity(ctx.db, {
        id: name, name, handle, avdName, serial: `emulator-${ports.consolePort}`, consolePort: ports.consolePort, mcpHostPort: ports.mcpHostPort,
        mcpToken: uuid(), deviceSlug: name, appPackage: CONFIG.targetApp.package, appVersionName: CONFIG.targetApp.versionName, state: 'provisioned',
      });
      done(ctx, name, 201);
    });
    provisioning = job.catch(() => undefined);
    await job;
  }

  /** Emulador aberto por fora (sem identidade no banco) também prende o AVD-base: pergunta o nome ao console de cada um. */
  async function runningAvd(devices: readonly string[], avd: string): Promise<{ serial: string } | undefined> {
    for (const serial of devices.filter((d) => d.startsWith('emulator-'))) {
      const name = await ops.adb.emu(serial, ['avd', 'name']).then((o) => o.split(/\r?\n/)[0].trim()).catch(() => '');
      if (name === avd) return { serial };
    }
    return undefined;
  }

  const boot: Action = async (ctx, id) => {
    const body = await parse(ctx, BootBody); if (!body) return;
    if (id.state === 'banned' || id.discardedAt) return ctx.send(409, { error: `identidade ${id.state}${id.discardedAt ? ' e descartada' : ''}` });
    ctx.send(202, { booting: true });
    background(async () => {
      try {
        const booted = await ops.boot(id, { window: body.window ?? false });
        const cur = getIdentity(ctx.db, id.id) ?? booted;
        if (ops.userLocked && (await ops.userLocked(cur))) {
          throw new Error(`${cur.avdName} tem bloqueio de tela com PIN/senha: digite-o na janela do emulador e remova o bloqueio (spec §4.1)`);
        }
        // Sem login ainda (inclusive após um boot que falhou e deixou 'offline'): volta a 'provisioned' sem sonda — a sonda não
        // olha sessão e marcaria 'idle' uma identidade sem conta. As demais são sondadas a cada subida (spec §4.1).
        if (awaitingLogin(cur) && ops.clearAccount && !cur.accountClearedAt) {
          await ops.clearAccount(cur);
          setIdentityFlags(ctx.db, id.id, { accountClearedAt: now() });
        }
        if (awaitingLogin(cur)) setIdentityState(ctx.db, id.id, 'provisioned', { lastError: null });
        else await ops.ensureReady(ctx.db, cur);
        ops.onIdentitiesChanged?.();
      } catch (e) {
        setIdentityState(ctx.db, id.id, 'offline', { lastError: errMsg(e) });
      }
      ctx.broadcast();
    });
  };

  const loginDone: Action = async (ctx, id) => {
    const body = await parse(ctx, LoginBody); if (!body) return;
    const handle = normalizeHandle(body.handle);
    if (!handle) return ctx.send(400, { error: 'handle inválido' });
    if (id.state === 'running' || id.state === 'banned' || id.discardedAt) return ctx.send(409, { error: `login-done indisponível em ${id.state}` });
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

  const discard: Action = async (ctx, id) => {
    if (id.state !== 'banned') return ctx.send(409, { error: 'só identidade banida pode ser descartada' });
    if (id.discardedAt) return ctx.send(409, { error: 'identidade já descartada' });
    if (id.avdName === base) return ctx.send(409, { error: `${id.avdName} é o AVD-base; não é descartável` });
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

  const actions: Readonly<Record<string, Action>> = { boot, 'login-done': loginDone, pause, resolve, ban, discard, restore, rebaseline };

  const route: Route = async (ctx) => {
    if (ctx.method !== 'POST') return false;
    const m = ROUTE.exec(ctx.url.pathname);
    if (!m) return false;
    const [, rawId, action] = m;
    if (!rawId) { await create(ctx); return true; }
    const act = actions[action];
    if (!act) return false; // /control, /input: Frente C
    const id = getIdentity(ctx.db, decodeURIComponent(rawId));
    if (!id) { ctx.send(404, { error: 'identidade desconhecida' }); return true; }
    await act(ctx, id);
    return true;
  };

  return { route, settle: async () => { while (pending.size) await Promise.all([...pending]); } };
}
