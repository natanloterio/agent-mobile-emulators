import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CONFIG } from '../../config.js';
import { ollamaBase } from '../config.js';
import { ProviderError } from '../errors.js';
import { isLoopbackHost } from '../ollama.js';
import type { Exec, LocalModelEntry, RuntimeListing, RuntimeStatus } from './types.js';

/** Mesmo contexto configurável que o daemon pede ao Ollama (`CONFIG.local.contextLength`, padrão 65536). */
const CONTEXT_LENGTH = String(CONFIG.local.contextLength);
const START_TIMEOUT_MS = 20_000;
const LOAD_TIMEOUT_MS = 180_000;
const LIST_TIMEOUT_MS = 20_000;

export interface LmStudioDeps {
  readonly exec?: Exec; readonly fetch?: typeof fetch; readonly sleep?: (ms: number) => Promise<void>;
  /** Caminho do `lms`; null = não instalado. Default: `~/.lmstudio/bin/lms` ou `lms` no PATH. */
  readonly lmsPath?: string | null;
  /** Paralelismo pedido na tela (spec paralelismo §UI): `ensure()` carrega um modelo novo já com `--parallel`. */
  readonly parallel?: () => number;
}

const defaultExec: Exec = (file, args, { timeoutMs }) => new Promise((resolve) => {
  execFile(file, [...args], { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
    const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? Number((err as { code?: number }).code) : 1) : 0;
    resolve({ stdout: String(stdout), stderr: String(stderr), code });
  });
});

export interface FindLmsDeps {
  readonly platform?: NodeJS.Platform; readonly home?: string; readonly pathEnv?: string; readonly exists?: (p: string) => boolean;
}

/** CLI do LM Studio: `~/.lmstudio/bin/lms`, senão o PATH; no Windows é `lms.exe` e o PATH separa por `;`. */
export function findLms(deps: FindLmsDeps = {}): string | null {
  const platform = deps.platform ?? process.platform;
  const exists = deps.exists ?? existsSync;
  const p = platform === 'win32' ? path.win32 : path.posix;
  const bin = platform === 'win32' ? 'lms.exe' : 'lms';
  const home = p.join(deps.home ?? os.homedir(), '.lmstudio', 'bin', bin);
  if (exists(home)) return home;
  const dirs = (deps.pathEnv ?? process.env.PATH ?? '').split(p.delimiter).filter(Boolean);
  return dirs.map((d) => p.join(d, bin)).find((f) => exists(f)) ?? null;
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
  /** Tira o modelo da memória: API REST do LM Studio, senão `lms unload`; não carregado: nada a fazer. */
  unload(endpoint: string, model: string): Promise<void>;
  /**
   * Paralelismo (spec paralelismo §Ocioso): recarrega (unload + load --parallel) o modelo carregado só se o
   * `parallel` real relatado por `lms ps --json` for um número e diferir do pedido; desconhecido (sem CLI, campo
   * ausente/null ou nada carregado) não mexe, devolve `null`. Chamado pelo `applyLocalParallel`, nunca pelo `ensure()`.
   */
  reloadIfParallelDiffers(endpoint: string, wanted: number): Promise<number | null>;
  stop(): void;
}

export function createLmStudio(deps: LmStudioDeps = {}): LmStudio {
  const exec = deps.exec ?? defaultExec; const f = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const lms = deps.lmsPath === undefined ? findLms() : deps.lmsPath;
  const getParallel = deps.parallel ?? (() => 1);
  let startedByUs = false;

  const v0 = async (endpoint: string): Promise<V0 | null> => {
    try { const r = await f(`${ollamaBase(endpoint)}/api/v0/models`); return r.ok ? ((await r.json()) as V0) : null; } catch { return null; }
  };
  const cli = async (): Promise<readonly LocalModelEntry[] | null> => {
    if (!lms) return null;
    const r = await exec(lms, ['ls', '--json'], { timeoutMs: LIST_TIMEOUT_MS });
    return r.code === 0 ? parseLmsLs(r.stdout) : null;
  };

  /** Contexto real do modelo carregado (`lms ps --json`); null = desconhecido (sem CLI ou saída ilegível). */
  const loadedContext = async (model: string): Promise<number | null> => {
    if (!lms) return null;
    const r = await exec(lms, ['ps', '--json'], { timeoutMs: LIST_TIMEOUT_MS });
    let loaded: { modelKey?: string; identifier?: string; contextLength?: number }[] = [];
    try { loaded = JSON.parse(r.stdout.slice(Math.max(0, r.stdout.indexOf('[')))) as typeof loaded; } catch { /* saída ilegível */ }
    const ctx = loaded.find((m) => m.identifier === model || m.modelKey === model)?.contextLength;
    return typeof ctx === 'number' ? ctx : null;
  };

  /** Paralelismo real do modelo carregado (`lms ps --json`, campo `parallel`); null = desconhecido (sem CLI, saída ilegível ou campo ausente/null). */
  const loadedParallel = async (model: string): Promise<number | null> => {
    if (!lms) return null;
    const r = await exec(lms, ['ps', '--json'], { timeoutMs: LIST_TIMEOUT_MS });
    let loaded: { modelKey?: string; identifier?: string; parallel?: number | null }[] = [];
    try { loaded = JSON.parse(r.stdout.slice(Math.max(0, r.stdout.indexOf('[')))) as typeof loaded; } catch { /* saída ilegível */ }
    const p = loaded.find((m) => m.identifier === model || m.modelKey === model)?.parallel;
    return typeof p === 'number' ? p : null;
  };

  /** Abaixo do contexto configurado os passos longos seriam truncados (spec local: contexto configurável). */
  const contextWarning = async (model: string): Promise<string | null> => {
    if (!lms) return `contexto desconhecido (sem o CLI lms): garanta contexto ≥ ${CONTEXT_LENGTH} no LM Studio`;
    const ctx = await loadedContext(model);
    if (ctx === null) return `contexto desconhecido no LM Studio: garanta contexto ≥ ${CONTEXT_LENGTH}`;
    return ctx >= Number(CONTEXT_LENGTH) ? null : `contexto do modelo no LM Studio é ${ctx} (< ${CONTEXT_LENGTH}): recarregue com lms load ${model} --context-length ${CONTEXT_LENGTH}`;
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
      error: null, models };
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
      const r = await exec(lms, ['load', model, '--context-length', CONTEXT_LENGTH, '--parallel', String(getParallel()), '-y'], { timeoutMs: LOAD_TIMEOUT_MS });
      if (r.code !== 0) throw new ProviderError('infra-local', `lms load ${model} falhou: ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
    } else if (lms) {
      // Já carregado com contexto menor que o configurado: recarrega (spec local: contexto configurável).
      const ctx = await loadedContext(model);
      if (typeof ctx === 'number' && ctx < Number(CONTEXT_LENGTH)) {
        await exec(lms, ['unload', model], { timeoutMs: LIST_TIMEOUT_MS });
        const r = await exec(lms, ['load', model, '--context-length', CONTEXT_LENGTH, '-y'], { timeoutMs: LOAD_TIMEOUT_MS });
        if (r.code !== 0) throw new ProviderError('infra-local', `lms load ${model} falhou: ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
      }
    }
    return { running: true, spawnedByUs: startedByUs, adopted: false, pid: null, models: (api.data ?? []).map((m) => m.id), contextWarning: await contextWarning(model) };
  };

  /** `POST /api/v1/models/unload` (LM Studio 0.4+): não depende do CLI, que pode ser recusado pelo servidor (passkey). */
  const restUnload = async (endpoint: string, model: string): Promise<string | null> => {
    try {
      const r = await f(`${ollamaBase(endpoint)}/api/v1/models/unload`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ instance_id: model }),
      });
      return r.ok ? null : `API ${r.status}: ${(await r.text().catch(() => '')).trim().slice(0, 120)}`;
    } catch (e) { return `API: ${String((e as Error)?.message ?? e).slice(0, 120)}`; }
  };

  const unload = async (endpoint: string, model: string): Promise<void> => {
    const api = await v0(endpoint);
    if (!api || !(api.data ?? []).some((m) => m.id === model && m.state === 'loaded')) return;
    const restError = await restUnload(endpoint, model);
    if (restError === null) return;
    if (!lms) throw new Error(`descarregar ${model}: ${restError}; sem o CLI lms para tentar de novo`);
    const r = await exec(lms, ['unload', model], { timeoutMs: LIST_TIMEOUT_MS });
    if (r.code !== 0) throw new Error(`descarregar ${model}: ${restError}; lms unload: ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
  };

  const reloadIfParallelDiffers = async (endpoint: string, wanted: number): Promise<number | null> => {
    if (!lms) return null;
    const api = await v0(endpoint);
    const found = (api?.data ?? []).find((m) => m.state === 'loaded');
    if (!found) return null; // nada carregado: nada a fazer aqui
    const current = await loadedParallel(found.id);
    if (current === null) return null; // desconhecido: não mexe
    if (current === wanted) return current;
    await exec(lms, ['unload', found.id], { timeoutMs: LIST_TIMEOUT_MS });
    const r = await exec(lms, ['load', found.id, '--context-length', CONTEXT_LENGTH, '--parallel', String(wanted), '-y'], { timeoutMs: LOAD_TIMEOUT_MS });
    if (r.code !== 0) {
      // Descarregou para trocar o paralelismo e o load de volta falhou: modelo fica descarregado — loga alto, não quebra o apply.
      console.error(`[lmstudio] lms load ${found.id} --parallel ${wanted} falhou depois do unload (modelo fica descarregado): ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
      return null;
    }
    return wanted;
  };

  return {
    list, ensure, unload, reloadIfParallelDiffers,
    // Kill switch / saída: só desliga o servidor se foi o daemon que o ligou (nunca o LM Studio aberto pelo usuário).
    stop: () => { if (startedByUs && lms) { startedByUs = false; void exec(lms, ['server', 'stop'], { timeoutMs: 10_000 }); } },
  };
}
