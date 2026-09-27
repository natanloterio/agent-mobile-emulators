import { spawn as nodeSpawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.js';
import { ollamaBase } from './config.js';
import { ProviderError } from './errors.js';

/** Loopback nas formas usadas por `OLLAMA_HOST`/endpoint: IPv4, IPv6 (com ou sem colchetes) e `localhost`, com porta opcional. */
export const isLoopbackHost = (host: string): boolean => /^(?:127\.0\.0\.1|localhost|\[::1\]|::1)(?::\d+)?$/i.test(host);

/** Spec §4.3: contexto ≥ 32k (passos chegam a ~19k), modelo fica quente entre passos, um worker por vez neste incremento. */
export const OLLAMA_ENV = { OLLAMA_CONTEXT_LENGTH: '32768', OLLAMA_KEEP_ALIVE: '30m', OLLAMA_NUM_PARALLEL: '1' } as const;
/** Marcador que identifica um `ollama serve` subido por este daemon (sobrevive a SIGKILL do pai). */
const CONTEXT_MARKER = `OLLAMA_CONTEXT_LENGTH=${OLLAMA_ENV.OLLAMA_CONTEXT_LENGTH}`;
const DEFAULT_TIMEOUT_MS = 20_000;
const POLL_MS = 250;

export interface ChildLike { readonly pid?: number; kill(signal?: NodeJS.Signals): boolean; on(ev: 'exit' | 'error', cb: (e?: Error) => void): unknown }
export interface OllamaProcess { readonly pid: number; readonly env: string }
export interface OllamaDeps {
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
}
export interface OllamaStatus {
  readonly running: boolean; readonly spawnedByUs: boolean; readonly adopted: boolean; readonly pid: number | null; readonly models: readonly string[];
  /** Aviso de contexto dado pelo runtime (LM Studio); ausente no Ollama, que usa a regra `spawnedByUs`. */
  readonly contextWarning?: string | null;
}
export interface OllamaSupervisor {
  /** `runtime` é ignorado aqui; existe para o despacho de runtimes locais (provider/runtimes/local.ts). */
  ensure(endpoint: string, model: string, runtime?: 'ollama' | 'lmstudio' | null): Promise<OllamaStatus>;
  unload(endpoint: string, model: string): Promise<void>;
  stop(): void;
  status(): OllamaStatus | null;
}

export function modelListed(models: readonly string[], wanted: string): boolean {
  const hasTag = wanted.includes(':');
  return models.some((m) => m === wanted || (!hasTag && m === `${wanted}:latest`) || (wanted.endsWith(':latest') && m === wanted.slice(0, -7)));
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
  let child: ChildLike | null = null;
  let adopted = false;
  let last: OllamaStatus | null = null;
  let logFd: unknown = null;
  const releaseLog = () => { if (logFd !== null) { closeLog(logFd); logFd = null; } };

  const checkModel = (models: readonly string[], model: string) => {
    if (!modelListed(models, model)) throw new ProviderError('infra-local', `modelo ${model} não está no disco do Ollama; rode: ollama pull ${model}`);
  };
  const adopt = (pid: number): ChildLike => ({ pid, kill: (sig) => { killFn(pid, sig ?? 'SIGTERM'); return true; }, on: () => undefined });
  const status = (models: readonly string[]): OllamaStatus => { last = { running: true, spawnedByUs: child !== null, adopted, pid: child?.pid ?? null, models }; return last; };

  return {
    status: () => last,
    stop: () => { if (child) { child.kill('SIGTERM'); child = null; adopted = false; } releaseLog(); },
    unload: async (endpoint, model) => {
      await fetchFn(`${ollamaBase(endpoint)}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, keep_alive: 0 }) }).catch(() => undefined);
    },
    ensure: async (endpoint, model) => {
      const base = ollamaBase(endpoint);
      // Só host:porta: um path no endpoint (`…/ollama/v1`) não pode virar "remoto" nem ir para OLLAMA_HOST.
      const host = new URL(base).host;
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
        child = spawnFn('ollama', ['serve'], { env: { ...process.env, ...OLLAMA_ENV, OLLAMA_HOST: host }, stdio: ['ignore', log, log] });
      } catch (e) { spawnErr = e as Error; child = null; releaseLog(); }
      child?.on('exit', () => { child = null; releaseLog(); });
      child?.on('error', (e) => { spawnErr = e ?? new Error('spawn error'); child = null; releaseLog(); });
      const t0 = Date.now();
      do {
        await sleep(POLL_MS);
        if (spawnErr) { child = null; throw new ProviderError('infra-local', `não foi possível iniciar \`ollama serve\` (${spawnErr.message}); confira se o binário ollama está no PATH do daemon`); }
        const models = await listModels(fetchFn, base);
        if (models) { checkModel(models, model); return status(models); }
      } while (Date.now() - t0 < timeoutMs);
      child?.kill('SIGTERM'); child = null;
      releaseLog();
      throw new ProviderError('infra-local', `Ollama não subiu em ${Math.round(timeoutMs / 1000)} s; veja ${logPath}`);
    },
  };
}
