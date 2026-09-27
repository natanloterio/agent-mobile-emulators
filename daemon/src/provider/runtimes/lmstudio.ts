import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ollamaBase } from '../config.js';
import { ProviderError } from '../errors.js';
import { isLoopbackHost } from '../ollama.js';
import type { Exec, LocalModelEntry, RuntimeListing, RuntimeStatus } from './types.js';

/** Mesmo contexto que o daemon pede ao Ollama (spec §4.3: passos chegam a ~19k tokens). */
const CONTEXT_LENGTH = '32768';
const START_TIMEOUT_MS = 20_000;
const LOAD_TIMEOUT_MS = 180_000;
const LIST_TIMEOUT_MS = 20_000;

export interface LmStudioDeps {
  readonly exec?: Exec; readonly fetch?: typeof fetch; readonly sleep?: (ms: number) => Promise<void>;
  /** Caminho do `lms`; null = não instalado. Default: `~/.lmstudio/bin/lms` ou `lms` no PATH. */
  readonly lmsPath?: string | null;
}

const defaultExec: Exec = (file, args, { timeoutMs }) => new Promise((resolve) => {
  execFile(file, [...args], { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
    const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? Number((err as { code?: number }).code) : 1) : 0;
    resolve({ stdout: String(stdout), stderr: String(stderr), code });
  });
});

function findLms(): string | null {
  const home = path.join(os.homedir(), '.lmstudio', 'bin', 'lms');
  if (existsSync(home)) return home;
  const onPath = (process.env.PATH ?? '').split(path.delimiter).map((d) => path.join(d, 'lms')).find((p) => existsSync(p));
  return onPath ?? null;
}

type LsItem = { type?: string; modelKey?: string; displayName?: string; sizeBytes?: number; trainedForToolUse?: boolean };
/** Saída de `lms ls --json` (o CLI escreve "Waking up…" antes do JSON). Só modelos de texto; embeddings ficam de fora. */
export function parseLmsLs(out: string): readonly LocalModelEntry[] {
  const i = out.indexOf('[');
  if (i < 0) return [];
  let items: LsItem[] = [];
  try { items = JSON.parse(out.slice(i)) as LsItem[]; } catch { return []; }
  return items.filter((m) => m.modelKey && m.type !== 'embedding').map((m) => ({
    id: m.modelKey!, runtime: 'lmstudio', label: m.displayName || m.modelKey!, sizeBytes: m.sizeBytes ?? null,
    loaded: null, toolUse: typeof m.trainedForToolUse === 'boolean' ? m.trainedForToolUse : null,
  }));
}

type V0 = { data?: { id: string; state?: string; type?: string; capabilities?: string[] }[] };

export interface LmStudio {
  list(endpoint: string): Promise<RuntimeListing>;
  ensure(endpoint: string, model: string): Promise<RuntimeStatus>;
  stop(): void;
}

export function createLmStudio(deps: LmStudioDeps = {}): LmStudio {
  const exec = deps.exec ?? defaultExec; const f = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const lms = deps.lmsPath === undefined ? findLms() : deps.lmsPath;
  let startedByUs = false;

  const v0 = async (endpoint: string): Promise<V0 | null> => {
    try { const r = await f(`${ollamaBase(endpoint)}/api/v0/models`); return r.ok ? ((await r.json()) as V0) : null; } catch { return null; }
  };
  const cli = async (): Promise<readonly LocalModelEntry[] | null> => {
    if (!lms) return null;
    const r = await exec(lms, ['ls', '--json'], { timeoutMs: LIST_TIMEOUT_MS });
    return r.code === 0 ? parseLmsLs(r.stdout) : null;
  };

  const list = async (endpoint: string): Promise<RuntimeListing> => {
    const [api, disk] = await Promise.all([v0(endpoint), cli()]);
    const state = new Map((api?.data ?? []).map((m) => [m.id, m.state === 'loaded']));
    // Sem CLI, a lista vem da API (só com o servidor no ar); embeddings ficam de fora.
    const base = disk ?? (api?.data ?? []).filter((m) => m.type !== 'embeddings' && m.type !== 'embedding').map((m): LocalModelEntry => ({
      id: m.id, runtime: 'lmstudio', label: m.id, sizeBytes: null, loaded: null, toolUse: m.capabilities ? m.capabilities.includes('tool_use') : null,
    }));
    const models = base.map((m) => ({ ...m, loaded: api ? (state.get(m.id) ?? false) : null }));
    const installed = !!lms || !!api;
    return { kind: 'lmstudio', label: 'LM Studio', endpoint, installed, running: !!api,
      error: api ? null : installed ? 'LM Studio parado — o próximo teste ou objetivo sobe o servidor' : null, models };
  };

  const ensure = async (endpoint: string, model: string): Promise<RuntimeStatus> => {
    let api = await v0(endpoint);
    if (!api) {
      const url = new URL(ollamaBase(endpoint));
      if (!isLoopbackHost(url.host)) throw new ProviderError('infra-local', `endpoint remoto ${url.host}: suba o servidor do LM Studio lá; o daemon só sobe processo local`);
      if (!lms) throw new ProviderError('infra-local', 'LM Studio parado e CLI `lms` não encontrado (~/.lmstudio/bin/lms): abra o LM Studio e ligue o servidor');
      const port = url.port || '1234';
      const r = await exec(lms, ['server', 'start', '--port', port], { timeoutMs: START_TIMEOUT_MS });
      if (r.code !== 0) throw new ProviderError('infra-local', `lms server start falhou: ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
      startedByUs = true;
      for (let t = 0; t < START_TIMEOUT_MS && !api; t += 500) { await sleep(500); api = await v0(endpoint); }
      if (!api) throw new ProviderError('infra-local', `servidor do LM Studio não respondeu em ${START_TIMEOUT_MS / 1000} s na porta ${port}`);
    }
    const found = (api.data ?? []).find((m) => m.id === model);
    if (!found) throw new ProviderError('infra-local', `modelo ${model} não está baixado no LM Studio; baixe com: lms get ${model}`);
    if (found.state !== 'loaded') {
      if (!lms) throw new ProviderError('infra-local', `modelo ${model} não está carregado e o CLI \`lms\` não foi encontrado: carregue-o no LM Studio`);
      const r = await exec(lms, ['load', model, '--context-length', CONTEXT_LENGTH, '-y'], { timeoutMs: LOAD_TIMEOUT_MS });
      if (r.code !== 0) throw new ProviderError('infra-local', `lms load ${model} falhou: ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
    }
    return { running: true, spawnedByUs: startedByUs, adopted: false, pid: null, models: (api.data ?? []).map((m) => m.id) };
  };

  return {
    list, ensure,
    // Kill switch / saída: só desliga o servidor se foi o daemon que o ligou (nunca o LM Studio aberto pelo usuário).
    stop: () => { if (startedByUs && lms) { startedByUs = false; void exec(lms, ['server', 'stop'], { timeoutMs: 10_000 }); } },
  };
}
