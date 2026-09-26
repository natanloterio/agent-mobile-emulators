import { spawn as nodeSpawn } from 'node:child_process';
import { openSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ollamaBase } from './config.js';
import { ProviderError } from './errors.js';

/** Spec §4.3: contexto ≥ 32k (passos chegam a ~19k), modelo fica quente entre passos, um worker por vez neste incremento. */
export const OLLAMA_ENV = { OLLAMA_CONTEXT_LENGTH: '32768', OLLAMA_KEEP_ALIVE: '30m', OLLAMA_NUM_PARALLEL: '1' } as const;
const DEFAULT_TIMEOUT_MS = 20_000;
const POLL_MS = 250;

export interface ChildLike { readonly pid?: number; kill(signal?: NodeJS.Signals): boolean; on(ev: 'exit', cb: () => void): unknown }
export interface OllamaDeps {
  readonly fetch?: typeof fetch;
  readonly spawn?: (cmd: string, args: readonly string[], opts: { env: NodeJS.ProcessEnv; stdio: unknown }) => ChildLike;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly timeoutMs?: number;
  readonly logPath?: string;
  readonly openLog?: (p: string) => unknown;
}
export interface OllamaStatus { readonly running: boolean; readonly spawnedByUs: boolean; readonly pid: number | null; readonly models: readonly string[] }
export interface OllamaSupervisor {
  ensure(endpoint: string, model: string): Promise<OllamaStatus>;
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

export function createOllamaSupervisor(deps: OllamaDeps = {}): OllamaSupervisor {
  const fetchFn = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const logPath = deps.logPath ?? path.join(os.homedir(), '.local', 'share', 'enxame', 'ollama.log');
  const openLog = deps.openLog ?? ((p: string) => openSync(p, 'a'));
  const spawnFn = deps.spawn ?? ((cmd, args, opts) => nodeSpawn(cmd, args, { env: opts.env, stdio: opts.stdio as never, detached: false }) as unknown as ChildLike);
  let child: ChildLike | null = null;
  let last: OllamaStatus | null = null;

  const checkModel = (models: readonly string[], model: string) => {
    if (!modelListed(models, model)) throw new ProviderError('infra-local', `modelo ${model} não está no disco do Ollama; rode: ollama pull ${model}`);
  };

  return {
    status: () => last,
    stop: () => { if (child) { child.kill('SIGTERM'); child = null; } },
    unload: async (endpoint, model) => {
      await fetchFn(`${ollamaBase(endpoint)}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, keep_alive: 0 }) }).catch(() => undefined);
    },
    ensure: async (endpoint, model) => {
      const base = ollamaBase(endpoint);
      const alive = await listModels(fetchFn, base);
      if (alive) { checkModel(alive, model); last = { running: true, spawnedByUs: child !== null, pid: child?.pid ?? null, models: alive }; return last; }
      const host = base.replace(/^https?:\/\//, '');
      const log = openLog(logPath);
      child = spawnFn('ollama', ['serve'], { env: { ...process.env, ...OLLAMA_ENV, OLLAMA_HOST: host }, stdio: ['ignore', log, log] });
      child.on('exit', () => { child = null; });
      const t0 = Date.now();
      do {
        await sleep(POLL_MS);
        const models = await listModels(fetchFn, base);
        if (models) { checkModel(models, model); last = { running: true, spawnedByUs: true, pid: child?.pid ?? null, models }; return last; }
      } while (Date.now() - t0 < timeoutMs);
      child?.kill('SIGTERM'); child = null;
      throw new ProviderError('infra-local', `Ollama não subiu em ${Math.round(timeoutMs / 1000)} s; veja ${logPath}`);
    },
  };
}
