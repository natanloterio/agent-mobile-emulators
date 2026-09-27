import { spawn as nodeSpawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CONFIG, ollamaBinFrom, readSetupPaths } from '../config.js';
import { ollamaBase } from './config.js';
import { ProviderError } from './errors.js';

/** Loopback nas formas usadas por `OLLAMA_HOST`/endpoint: IPv4, IPv6 (com ou sem colchetes) e `localhost`, com porta opcional. */
export const isLoopbackHost = (host: string): boolean => /^(?:127\.0\.0\.1|localhost|\[::1\]|::1)(?::\d+)?$/i.test(host);

/**
 * Spec §4.3: contexto configurável (`CONFIG.local.contextLength`, padrão 65536), modelo fica quente entre passos.
 * `OLLAMA_NUM_PARALLEL` não mora aqui: vem de `deps.parallel()` (spec paralelismo §UI), sobrescrito no env do spawn.
 */
export const OLLAMA_ENV = { OLLAMA_CONTEXT_LENGTH: String(CONFIG.local.contextLength), OLLAMA_KEEP_ALIVE: '30m' } as const;
/**
 * Marcador que identifica um `ollama serve` subido por este daemon (sobrevive a SIGKILL do pai). Um órfão de antes de
 * trocar `ENXAME_LOCAL_CONTEXT` (ou de antes deste incremento, com o antigo 32768 fixo) carrega o valor VELHO no env
 * e não bate com o marcador atual: vira "externo" (spawnedByUs=false) e é usado como está, no contexto antigo — pare
 * o `ollama serve` rodando para o daemon subir um novo com o contexto certo.
 */
const CONTEXT_MARKER = `OLLAMA_CONTEXT_LENGTH=${OLLAMA_ENV.OLLAMA_CONTEXT_LENGTH}`;
const DEFAULT_TIMEOUT_MS = 20_000;
const POLL_MS = 250;

export interface ChildLike { readonly pid?: number; kill(signal?: NodeJS.Signals): boolean; on(ev: 'exit' | 'error', cb: (e?: Error) => void): unknown }
export interface OllamaProcess { readonly pid: number; readonly env: string }
export interface OllamaDeps {
  /** Binário do Ollama fixo (testes); ausente = `resolveBin` a cada spawn. */
  readonly bin?: string;
  /** Resolve o binário na hora do spawn; padrão: relê o setup.json (`ENXAME_OLLAMA_BIN`, o do onboarding ou o do PATH). */
  readonly resolveBin?: () => string;
  readonly fetch?: typeof fetch;
  readonly spawn?: (cmd: string, args: readonly string[], opts: { env: NodeJS.ProcessEnv; stdio: unknown }) => ChildLike;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly timeoutMs?: number;
  readonly logPath?: string;
  readonly openLog?: (p: string) => unknown;
  readonly closeLog?: (fd: unknown) => void;
  /** Processos `ollama serve` vivos com o env de cada um (para adotar um órfão nosso). */
  readonly findProcesses?: () => readonly OllamaProcess[];
  readonly kill?: (pid: number, signal: NodeJS.Signals) => void;
  /** Paralelismo pedido na tela (spec paralelismo §UI), lido a cada spawn; ausente = 1 (default de `readLocalParallel`). */
  readonly parallel?: () => number;
}
export interface OllamaStatus {
  readonly running: boolean; readonly spawnedByUs: boolean; readonly adopted: boolean; readonly pid: number | null; readonly models: readonly string[];
  /** Aviso de contexto dado pelo runtime (LM Studio); ausente no Ollama, que usa a regra `spawnedByUs`. */
  readonly contextWarning?: string | null;
}
export interface OllamaSupervisor {
  /** `runtime` é ignorado aqui; existe para o despacho de runtimes locais (provider/runtimes/local.ts). */
  ensure(endpoint: string, model: string, runtime?: 'ollama' | 'lmstudio' | null): Promise<OllamaStatus>;
  /** `runtime` é ignorado aqui; existe para o despacho de runtimes locais (provider/runtimes/local.ts). */
  unload(endpoint: string, model: string, runtime?: 'ollama' | 'lmstudio' | null): Promise<void>;
  /**
   * Kill switch (spec §4.3): NUNCA espera a trava do single-flight — precisa ser imediato mesmo com uma troca de
   * paralelismo em andamento (que pode levar minutos). Avança a "geração": `ensure()`/`restartIfParallelDiffers`
   * em voo percebem na próxima checagem, matam o que acabaram de subir e desistem sem reivindicar o processo.
   */
  stop(): void;
  status(): OllamaStatus | null;
  /**
   * Paralelismo (spec paralelismo §Ocioso): só mexe se o `ollama serve` rodando é nosso (spawnado ou adotado) e o
   * `OLLAMA_NUM_PARALLEL` real do processo (lido do `/proc`, como o marcador de contexto) difere do pedido — aí
   * mata e sobe de novo com o valor novo. Sem Ollama nosso ou valor real desconhecido: não mexe, devolve `null`.
   */
  restartIfParallelDiffers(wanted: number): Promise<number | null>;
}

export function modelListed(models: readonly string[], wanted: string): boolean {
  const hasTag = wanted.includes(':');
  return models.some((m) => m === wanted || (!hasTag && m === `${wanted}:latest`) || (wanted.endsWith(':latest') && m === wanted.slice(0, -7)));
}

let warnedExternalOllama = false;
/** Só para teste: reseta o aviso de uma vez por processo. */
export function resetExternalOllamaWarning(): void { warnedExternalOllama = false; }

/**
 * Aviso de uma vez por processo (console.warn) quando o Ollama em uso não foi subido pelo daemon (spawnedByUs=false):
 * pode ser um órfão de antes de trocar `ENXAME_LOCAL_CONTEXT` (marcador antigo) ou um Ollama externo de verdade —
 * dos dois jeitos, o contexto pode ser menor que o configurado e o daemon nunca reinicia esse processo sozinho.
 * `contextWarning` presente identifica LM Studio (que já recarrega/avisa sozinho no próprio `ensure`); ignorado aqui.
 */
export function warnIfExternalOllama(status: { readonly spawnedByUs?: boolean; readonly contextWarning?: string | null }): void {
  if (status.contextWarning !== undefined || status.spawnedByUs !== false || warnedExternalOllama) return;
  warnedExternalOllama = true;
  console.warn(`[ollama] Ollama externo em uso: o contexto pode ser menor que ENXAME_LOCAL_CONTEXT=${CONFIG.local.contextLength}; pare o ollama serve para o daemon subir um com o contexto certo`);
}

async function listModels(fetchFn: typeof fetch, base: string): Promise<readonly string[] | null> {
  try {
    const r = await fetchFn(`${base}/api/tags`);
    if (!r.ok) return null;
    const j = await r.json() as { models?: { name: string }[] };
    return (j.models ?? []).map((m) => m.name);
  } catch { return null; }
}

/** Varre /proc por `ollama serve`; processos de outros usuários ou já mortos são ignorados. Sob vitest sem injeção: nada. */
function defaultFindProcesses(): readonly OllamaProcess[] {
  if (process.env.VITEST) return [];
  const out: OllamaProcess[] = [];
  let pids: string[] = [];
  try { pids = readdirSync('/proc').filter((d) => /^\d+$/.test(d)); } catch { return out; }
  for (const p of pids) {
    try {
      const cmd = readFileSync(`/proc/${p}/cmdline`, 'utf8');
      if (!/(^|\/)ollama\0serve\0?$/.test(cmd)) continue;
      out.push({ pid: Number(p), env: readFileSync(`/proc/${p}/environ`, 'utf8') });
    } catch { /* sem permissão ou já saiu */ }
  }
  return out;
}

export function createOllamaSupervisor(deps: OllamaDeps = {}): OllamaSupervisor {
  const fetchFn = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const logPath = deps.logPath ?? path.join(CONFIG.dataDir, 'ollama.log');
  const openLog = deps.openLog ?? ((p: string) => { mkdirSync(path.dirname(p), { recursive: true }); return openSync(p, 'a'); });
  const closeLog = deps.closeLog ?? ((fd: unknown) => { try { closeSync(fd as number); } catch { /* já fechado */ } });
  const findProcesses = deps.findProcesses ?? defaultFindProcesses;
  const killFn = deps.kill ?? ((pid: number, sig: NodeJS.Signals) => { try { process.kill(pid, sig); } catch { /* já morreu */ } });
  const spawnFn = deps.spawn ?? ((cmd, args, opts) => nodeSpawn(cmd, args, { env: opts.env, stdio: opts.stdio as never, detached: false }) as unknown as ChildLike);
  const resolveBin = deps.resolveBin ?? (() => ollamaBinFrom(readSetupPaths(CONFIG.setupPath), process.env));
  const getParallel = deps.parallel ?? (() => 1);
  let child: ChildLike | null = null;
  let adopted = false;
  let last: OllamaStatus | null = null;
  let logFd: unknown = null;
  // Último host:porta usado (spec paralelismo): guardado para o restart poder subir de novo sem repetir `ensure(endpoint, model)`.
  let lastHost: string | null = null;
  // Geração do kill switch (revisão paralelismo): stop() avança; ensure()/restartIfParallelDiffers capturam o
  // valor no início e o conferem depois de cada await — mudou, é porque stop() rodou enquanto subíamos um processo
  // novo; matamos o que acabamos de spawnar e desistimos, sem reivindicar (child fica null, sem status de sucesso).
  let stopEpoch = 0;
  const releaseLog = () => { if (logFd !== null) { closeLog(logFd); logFd = null; } };

  const checkModel = (models: readonly string[], model: string) => {
    if (!modelListed(models, model)) throw new ProviderError('infra-local', `modelo ${model} não está no disco do Ollama; rode: ollama pull ${model}`);
  };
  const adopt = (pid: number): ChildLike => ({ pid, kill: (sig) => { killFn(pid, sig ?? 'SIGTERM'); return true; }, on: () => undefined });
  const status = (models: readonly string[]): OllamaStatus => { last = { running: true, spawnedByUs: child !== null, adopted, pid: child?.pid ?? null, models }; return last; };
  /**
   * Kill switch rodou desde `myEpoch` (revisão paralelismo): mata o que a chamada atual acabou de spawnar (ou já
   * matou, via stop()) e sinaliza para a chamada desistir sem reivindicar sucesso. Checado depois de CADA await no
   * loop de espera — inclusive depois do `listModels`, para não reivindicar um processo que já devia estar morto.
   */
  const stoppedMidFlight = (myEpoch: number): boolean => {
    if (myEpoch === stopEpoch) return false;
    child?.kill('SIGTERM'); child = null; releaseLog();
    return true;
  };

  return {
    status: () => last,
    stop: () => { stopEpoch++; if (child) { child.kill('SIGTERM'); child = null; adopted = false; } releaseLog(); },
    unload: async (endpoint, model) => {
      await fetchFn(`${ollamaBase(endpoint)}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, keep_alive: 0 }) }).catch(() => undefined);
    },
    ensure: async (endpoint, model) => {
      const myEpoch = stopEpoch;
      const base = ollamaBase(endpoint);
      // Só host:porta: um path no endpoint (`…/ollama/v1`) não pode virar "remoto" nem ir para OLLAMA_HOST.
      const host = new URL(base).host;
      lastHost = host;
      const alive = await listModels(fetchFn, base);
      if (alive) {
        checkModel(alive, model);
        // Ollama vivo que não é nosso filho: se carrega o nosso env, é um órfão de um daemon anterior — adotamos (spec §4.3 passo 4).
        // Um processo local nunca serve um endpoint remoto, então só adotamos quando o host é loopback.
        if (child === null && isLoopbackHost(host)) {
          const own = findProcesses().find((p) => p.env.includes(CONTEXT_MARKER) && (!/(^|\0)OLLAMA_HOST=/.test(p.env) || p.env.includes(`OLLAMA_HOST=${host}`)));
          if (own) { child = adopt(own.pid); adopted = true; }
        }
        return status(alive);
      }
      if (!isLoopbackHost(host)) throw new ProviderError('infra-local', `endpoint remoto ${host}: suba o Ollama lá; o daemon só sobe processo local`);
      if (!deps.spawn && process.env.VITEST) throw new ProviderError('infra-local', 'spawn do Ollama desabilitado em teste (injete deps.spawn)');
      let spawnErr: Error | null = null;
      adopted = false;
      try {
        const log = openLog(logPath); logFd = log;
        child = spawnFn(deps.bin ?? resolveBin(), ['serve'], { env: { ...process.env, ...OLLAMA_ENV, OLLAMA_NUM_PARALLEL: String(getParallel()), OLLAMA_HOST: host }, stdio: ['ignore', log, log] });
      } catch (e) { spawnErr = e as Error; child = null; releaseLog(); }
      child?.on('exit', () => { child = null; releaseLog(); });
      child?.on('error', (e) => { spawnErr = e ?? new Error('spawn error'); child = null; releaseLog(); });
      const t0 = Date.now();
      const killSwitchErr = () => new ProviderError('infra-local', 'kill switch pressionado durante a subida do Ollama; ele fica parado');
      do {
        await sleep(POLL_MS);
        if (stoppedMidFlight(myEpoch)) throw killSwitchErr();
        if (spawnErr) { child = null; throw new ProviderError('infra-local', `não foi possível iniciar \`ollama serve\` (${spawnErr.message}); confira se o binário ollama está no PATH do daemon`); }
        const models = await listModels(fetchFn, base);
        if (stoppedMidFlight(myEpoch)) throw killSwitchErr();
        if (models) { checkModel(models, model); return status(models); }
      } while (Date.now() - t0 < timeoutMs);
      child?.kill('SIGTERM'); child = null;
      releaseLog();
      throw new ProviderError('infra-local', `Ollama não subiu em ${Math.round(timeoutMs / 1000)} s; veja ${logPath}`);
    },
    restartIfParallelDiffers: async (wanted) => {
      const myEpoch = stopEpoch;
      if (child === null) {
        // Órfão nosso de uma subida anterior do daemon pode estar rodando mesmo sem nenhum ensure() nesta subida
        // (ex.: PUT /settings/local antes de qualquer tarefa) — mesma adoção por marcador do ensure(), mas sem um
        // endpoint à mão: aceita qualquer órfão com o marcador e lê o host de verdade do próprio env dele.
        const own = findProcesses().find((p) => p.env.includes(CONTEXT_MARKER));
        if (own) {
          const hostMatch = /(?:^|\0)OLLAMA_HOST=([^\0]*)/.exec(own.env);
          child = adopt(own.pid); adopted = true; lastHost = hostMatch?.[1] || '127.0.0.1:11434';
        }
      }
      if (child === null || child.pid == null || !lastHost) return null;
      const pid = child.pid;
      const own = findProcesses().find((p) => p.pid === pid);
      const m = own ? /(?:^|\0)OLLAMA_NUM_PARALLEL=(\d+)/.exec(own.env) : null;
      if (!m) return null; // desconhecido (sem info do /proc): não mexe
      const current = Number(m[1]);
      if (current === wanted) return current;
      const host = lastHost;
      const base = `http://${host}`;
      child.kill('SIGTERM'); child = null; adopted = false; releaseLog();
      let spawnErr: Error | null = null;
      try {
        const log = openLog(logPath); logFd = log;
        child = spawnFn(deps.bin ?? resolveBin(), ['serve'], { env: { ...process.env, ...OLLAMA_ENV, OLLAMA_NUM_PARALLEL: String(wanted), OLLAMA_HOST: host }, stdio: ['ignore', log, log] });
      } catch (e) { spawnErr = e as Error; child = null; releaseLog(); }
      child?.on('exit', () => { child = null; releaseLog(); });
      child?.on('error', (e) => { spawnErr = e ?? new Error('spawn error'); child = null; releaseLog(); });
      const t0 = Date.now();
      do {
        await sleep(POLL_MS);
        if (stoppedMidFlight(myEpoch)) return null;
        if (spawnErr) return null;
        const models = await listModels(fetchFn, base);
        if (stoppedMidFlight(myEpoch)) return null;
        if (models) { status(models); return wanted; }
      } while (Date.now() - t0 < timeoutMs);
      child?.kill('SIGTERM'); child = null;
      releaseLog();
      return null;
    },
  };
}
