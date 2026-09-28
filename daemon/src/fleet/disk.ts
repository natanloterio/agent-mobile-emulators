import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { CONFIG } from '../config.js';
import { listFleet, setIdentityFlags } from '../db/identities.js';
import { isValidAvdName } from './avd.js';

/** Ocupação em disco por identidade (spec inc. 5 §2): soma dos arquivos do diretório do AVD, cacheada. */
export interface DiskUsage {
  get(avdName: string): Promise<number>;
  invalidate(avdName: string): void;
}

/**
 * Tamanho aparente de todos os arquivos sob `dir` (o que o `du -sb` media), em Node puro para rodar em qualquer SO.
 * Symlinks não são seguidos: contam só o próprio link, como no `du`.
 */
export async function dirBytes(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? await dirBytes(p) : (await lstat(p)).size;
  }
  return total;
}

export function createDiskUsage(deps: { measure?: (dir: string) => Promise<number>; home?: string; cacheMs?: number; now?: () => number } = {}): DiskUsage {
  const measure = deps.measure ?? dirBytes;
  const home = deps.home ?? CONFIG.avd.home;
  const cacheMs = deps.cacheMs ?? CONFIG.avd.diskCacheMs;
  const now = deps.now ?? Date.now;
  const cache = new Map<string, { bytes: number; at: number }>();
  return {
    invalidate: (name) => { cache.delete(name); },
    get: async (name) => {
      if (!isValidAvdName(name)) throw new Error(`nome de AVD inválido: "${name}"`);
      const hit = cache.get(name);
      if (hit && now() - hit.at <= cacheMs) return hit.bytes;
      let bytes: number;
      try { bytes = await measure(path.join(home, `${name}.avd`)); } catch (e) { throw new Error(`disco falhou para ${name}: ${(e as Error).message}`); }
      cache.set(name, { bytes, at: now() });
      return bytes;
    },
  };
}

/** Uma passada do coletor: atualiza `disk_bytes` das identidades não descartadas. `true` se algo mudou (para broadcast). */
export async function collectDisk(db: DatabaseSync, disk: DiskUsage): Promise<boolean> {
  let changed = false;
  for (const id of listFleet(db)) {
    if (id.discardedAt) continue;
    try {
      const bytes = await disk.get(id.avdName);
      if (bytes !== id.diskBytes) { setIdentityFlags(db, id.id, { diskBytes: bytes }); changed = true; }
    } catch (e) {
      console.error(`[disco] ${id.id}: ${(e as Error).message}`);
    }
  }
  return changed;
}

/** Coletor em segundo plano; passadas não se sobrepõem. Devolve o `stop`. */
export function startDiskCollector(
  db: DatabaseSync, disk: DiskUsage, onChange: () => void,
  opts: { intervalMs?: number; setInterval?: (fn: () => void, ms: number) => NodeJS.Timeout; clearInterval?: (t: NodeJS.Timeout) => void } = {},
): () => void {
  let running = false;
  const pass = () => {
    if (running) return;
    running = true;
    collectDisk(db, disk).then((c) => { if (c) onChange(); }).catch((e: unknown) => console.error('[disco] coletor:', e)).finally(() => { running = false; });
  };
  pass();
  const t = (opts.setInterval ?? setInterval)(pass, opts.intervalMs ?? CONFIG.avd.diskCacheMs);
  return () => (opts.clearInterval ?? clearInterval)(t);
}
