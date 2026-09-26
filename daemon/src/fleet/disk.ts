import { execFile } from 'node:child_process';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { CONFIG } from '../config.js';
import { listIdentities, setIdentityFlags } from '../db/identities.js';
import type { Exec } from '../device/adb.js';
import { isValidAvdName } from './avd.js';

/** Ocupação em disco por identidade (spec inc. 5 §2): `du -sb` do diretório do AVD, cacheado. */
export interface DiskUsage {
  get(avdName: string): Promise<number>;
  invalidate(avdName: string): void;
}

export const parseDu = (out: string): number | null => {
  const m = /^(\d+)\s/.exec(out.trim() + ' ');
  return m ? Number(m[1]) : null;
};

const defaultExec: Exec = (file, args, env) => new Promise((resolve) => {
  execFile(file, [...args], { env, timeout: 60_000 }, (err, stdout, stderr) => resolve({ stdout: String(stdout), stderr: String(stderr), code: err ? 1 : 0 }));
});

export function createDiskUsage(deps: { exec?: Exec; home?: string; cacheMs?: number; now?: () => number } = {}): DiskUsage {
  const exec = deps.exec ?? defaultExec;
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
      const r = await exec('du', ['-sb', path.join(home, `${name}.avd`)], process.env);
      const bytes = r.code === 0 ? parseDu(r.stdout) : null;
      if (bytes === null) throw new Error(`du falhou para ${name}: ${(r.stderr || r.stdout).trim() || `código ${r.code}`}`);
      cache.set(name, { bytes, at: now() });
      return bytes;
    },
  };
}

/** Uma passada do coletor: atualiza `disk_bytes` das identidades não descartadas. `true` se algo mudou (para broadcast). */
export async function collectDisk(db: DatabaseSync, disk: DiskUsage): Promise<boolean> {
  let changed = false;
  for (const id of listIdentities(db)) {
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
