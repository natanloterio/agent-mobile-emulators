import { execFile } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findLms } from '../provider/runtimes/lmstudio.js';
import type { GpuBreakdown, GpuSlice } from '../server/snapshot.js';

/** Um processo na GPU (`nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader`). */
export interface GpuApp { readonly pid: number; readonly name: string; readonly usedMiB: number }

export function parseComputeApps(out: string): readonly GpuApp[] {
  return out.split('\n').map((l) => /^\s*(\d+)\s*,\s*(.+?)\s*,\s*(\d+)\s*MiB\s*$/.exec(l)).filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ pid: Number(m[1]), name: m[2], usedMiB: Number(m[3]) }));
}

export interface GpuDeps {
  /** Linha de comando do processo (/proc/<pid>/cmdline); null se não der para ler. */
  readonly cmdline: (pid: number) => string | null;
  /** Arquivo do blob do Ollama (`sha256-…`) → nome do modelo, a partir dos manifests. */
  readonly ollamaBlobs: () => ReadonlyMap<string, string>;
  /** Modelos carregados no LM Studio (`lms ps`); chamado só se houver processo do LM Studio na GPU. */
  readonly lmsLoaded: () => Promise<readonly string[]>;
}

const isEmulator = (a: GpuApp) => /qemu-system/.test(a.name);
const OLLAMA_BLOB = /--model\s+\S*\/blobs\/(sha256-[0-9a-f]+)/;
const isLmStudio = (cmd: string | null, a: GpuApp) => /\.lmstudio\//.test(a.name) || (!!cmd && /\.lmstudio\/.*llmworker/.test(cmd));

/**
 * Fatias da VRAM (spec: painel real em Provedores): cada modelo pelo processo que o serve (Ollama: blob do `--model`;
 * LM Studio: processo `llmworker`), emuladores somados, e "outros" = usado − o resto (inclui processos só gráficos,
 * que o nvidia-smi não lista por processo). Rótulos `emulators`/`other` são traduzidos na tela.
 */
export async function classifyGpu(apps: readonly GpuApp[], total: { usedMiB: number; totalMiB: number }, d: GpuDeps): Promise<Omit<GpuBreakdown, 'at'>> {
  const models: GpuSlice[] = []; let emu = 0; let lmsMiB = 0;
  let blobs: ReadonlyMap<string, string> | null = null;
  for (const a of apps) {
    if (isEmulator(a)) { emu += a.usedMiB; continue; }
    const cmd = d.cmdline(a.pid);
    const blob = cmd ? OLLAMA_BLOB.exec(cmd)?.[1] : undefined;
    if (blob || /ollama/.test(a.name)) {
      blobs ??= d.ollamaBlobs();
      const name = blob ? blobs.get(blob) : undefined;
      models.push({ kind: 'model', label: `${name ?? 'Ollama (modelo desconhecido)'}${name ? ' · Ollama' : ''}`, usedMiB: a.usedMiB, runtime: 'ollama' });
    } else if (isLmStudio(cmd, a)) lmsMiB += a.usedMiB;
  }
  if (lmsMiB > 0) {
    const loaded = await d.lmsLoaded().catch(() => [] as readonly string[]);
    models.push({ kind: 'model', label: `${loaded.length ? loaded.join(', ') : 'modelo'} · LM Studio`, usedMiB: lmsMiB, runtime: 'lmstudio' });
  }
  const slices: GpuSlice[] = [...models];
  if (emu > 0) slices.push({ kind: 'emulators', label: 'emulators', usedMiB: emu });
  const other = total.usedMiB - models.reduce((a, s) => a + s.usedMiB, 0) - emu;
  if (other > 0) slices.push({ kind: 'other', label: 'other', usedMiB: other });
  return { usedMiB: total.usedMiB, totalMiB: total.totalMiB, slices };
}

const run = (file: string, args: readonly string[], timeout = 5000) => new Promise<string>((resolve, reject) => {
  execFile(file, [...args], { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
});

/** Manifests do Ollama: blob da camada do modelo → `nome:tag` (mesma convenção de provider/runtimes/ollama-models). */
function readOllamaBlobs(): ReadonlyMap<string, string> {
  const root = path.join(process.env.OLLAMA_MODELS ?? path.join(os.homedir(), '.ollama', 'models'), 'manifests');
  const out = new Map<string, string>();
  const walk = (dir: string, parts: string[]) => {
    let names: string[] = []; try { names = readdirSync(dir); } catch { return; }
    for (const n of names) {
      const p = path.join(dir, n); const next = [...parts, n];
      let isDir = false; try { isDir = statSync(p).isDirectory(); } catch { continue; }
      if (isDir && next.length < 4) { walk(p, next); continue; }
      if (isDir || next.length !== 4) continue;
      try {
        const layers = (JSON.parse(readFileSync(p, 'utf8')) as { layers?: { mediaType?: string; digest?: string }[] }).layers ?? [];
        const model = layers.find((l) => l.mediaType === 'application/vnd.ollama.image.model')?.digest;
        const [registry, ns, name, tag] = next;
        const label = registry === 'registry.ollama.ai' ? (ns === 'library' ? `${name}:${tag}` : `${ns}/${name}:${tag}`) : `${registry}/${ns}/${name}:${tag}`;
        if (model) out.set(model.replace(':', '-'), label);
      } catch { /* manifest ilegível */ }
    }
  };
  walk(root, []);
  return out;
}


/** Implementação real das dependências (nvidia-smi, /proc, manifests do Ollama, `lms ps`). */
export function createGpuSampler(): (total: { usedMiB: number; totalMiB: number }) => Promise<Omit<GpuBreakdown, 'at'> | null> {
  let blobs: { at: number; map: ReadonlyMap<string, string> } | null = null;
  const deps: GpuDeps = {
    cmdline: (pid) => { try { return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' '); } catch { return null; } },
    ollamaBlobs: () => { if (!blobs || Date.now() - blobs.at > 60_000) blobs = { at: Date.now(), map: readOllamaBlobs() }; return blobs.map; },
    lmsLoaded: async () => {
      const lms = findLms();
      if (!lms) throw new Error('CLI lms do LM Studio não encontrado');
      const out = await run(lms, ['ps', '--json'], 10_000);
      return (JSON.parse(out.slice(Math.max(0, out.indexOf('[')))) as { identifier?: string; modelKey?: string }[]).map((m) => m.identifier ?? m.modelKey ?? '?');
    },
  };
  return async (total) => {
    try { return await classifyGpu(parseComputeApps(await run('nvidia-smi', ['--query-compute-apps=pid,process_name,used_memory', '--format=csv,noheader'])), total, deps); }
    catch { return null; }
  };
}
