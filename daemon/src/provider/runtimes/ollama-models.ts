import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ollamaBase } from '../config.js';
import type { LocalModelEntry, RuntimeListing } from './types.js';

export interface OllamaListDeps {
  readonly fetch?: typeof fetch;
  /** Modelos no disco (manifests), para quando o servidor está parado. */
  readonly manifests?: () => readonly { name: string; sizeBytes: number | null }[];
  readonly installed?: () => boolean;
}

/** Caminho de um manifest (`<registry>/<namespace>/<nome>/<tag>`) no nome que o `ollama run` aceita. */
export function manifestName(parts: readonly string[]): string {
  const [registry, ns, name, tag] = parts;
  if (registry === 'registry.ollama.ai') return ns === 'library' ? `${name}:${tag}` : `${ns}/${name}:${tag}`;
  return `${registry}/${ns}/${name}:${tag}`;
}

const modelsDir = () => process.env.OLLAMA_MODELS ?? path.join(os.homedir(), '.ollama', 'models');

/** Varre `manifests/` (4 níveis) e soma o tamanho das camadas. Nunca lança. */
export function diskManifests(dir = modelsDir()): readonly { name: string; sizeBytes: number | null }[] {
  const root = path.join(dir, 'manifests'); const out: { name: string; sizeBytes: number | null }[] = [];
  const walk = (d: string, parts: string[]) => {
    let entries: string[] = [];
    try { entries = readdirSync(d); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e); const next = [...parts, e];
      let isDir = false; try { isDir = statSync(p).isDirectory(); } catch { continue; }
      if (isDir && next.length < 4) walk(p, next);
      else if (!isDir && next.length === 4) {
        let size: number | null = null;
        try { size = (JSON.parse(readFileSync(p, 'utf8')) as { layers?: { size?: number }[] }).layers?.reduce((a, l) => a + (l.size ?? 0), 0) ?? null; } catch { /* manifest ilegível */ }
        out.push({ name: manifestName(next), sizeBytes: size });
      }
    }
  };
  walk(root, []);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const onPath = (bin: string) => (process.env.PATH ?? '').split(path.delimiter).some((d) => d && existsSync(path.join(d, bin)));

async function getJson<T>(f: typeof fetch, url: string): Promise<T | null> {
  try { const r = await f(url); return r.ok ? ((await r.json()) as T) : null; } catch { return null; }
}

/** Modelos do Ollama: da API com o servidor no ar (com o que está carregado), do disco com ele parado. */
export async function listOllama(endpoint: string, deps: OllamaListDeps = {}): Promise<RuntimeListing> {
  const f = deps.fetch ?? fetch; const base = ollamaBase(endpoint);
  const installed = (deps.installed ?? (() => onPath('ollama') || existsSync(modelsDir())))();
  const entry = (id: string, sizeBytes: number | null, loaded: boolean | null): LocalModelEntry => ({ id, runtime: 'ollama', label: id, sizeBytes, loaded, toolUse: null });
  const tags = await getJson<{ models?: { name: string; size?: number }[] }>(f, `${base}/api/tags`);
  if (tags && Array.isArray(tags.models)) {
    const ps = await getJson<{ models?: { name: string }[] }>(f, `${base}/api/ps`);
    const loaded = new Set((ps?.models ?? []).map((m) => m.name));
    return { kind: 'ollama', label: 'Ollama', endpoint, installed: true, running: true, error: null,
      models: tags.models.map((m) => entry(m.name, m.size ?? null, ps ? loaded.has(m.name) : null)) };
  }
  const disk = (deps.manifests ?? (() => diskManifests()))();
  return { kind: 'ollama', label: 'Ollama', endpoint, installed, running: false,
    error: installed ? 'Ollama parado — o próximo teste ou objetivo o sobe' : null,
    models: disk.map((m) => entry(m.name, m.sizeBytes, null)) };
}
