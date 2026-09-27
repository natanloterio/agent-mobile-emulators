import { execFile } from 'node:child_process';
import { statfs } from 'node:fs/promises';
import os from 'node:os';
import type { Hardware } from './types.js';

export interface HardwareDeps {
  readonly totalMemBytes: () => number;
  readonly cpus: () => readonly { readonly model: string }[];
  /** stdout, ou null se o comando não existe ou falhou. */
  readonly exec: (cmd: string, args: readonly string[]) => Promise<string | null>;
  readonly freeDiskBytes: (dir: string) => Promise<number>;
}

const GiB = 2 ** 30;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** `nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits` → primeira GPU. */
export function parseNvidiaGpu(out: string | null): Hardware['gpu'] {
  const line = out?.split('\n').map((s) => s.trim()).find(Boolean);
  if (!line) return null;
  const [name, mib] = line.split(',').map((s) => s.trim());
  const n = Number(mib);
  if (!name || !Number.isFinite(n) || n <= 0) return null;
  return { name: name.replace(/^NVIDIA\s+(GeForce\s+)?/, ''), totalGiB: round1(n / 1024) };
}

export async function readHardware(home: string, d: HardwareDeps): Promise<Hardware> {
  const cpus = d.cpus();
  const [gpuOut, free] = await Promise.all([
    d.exec('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']),
    d.freeDiskBytes(home).catch(() => 0),
  ]);
  return {
    ramGiB: round1(d.totalMemBytes() / GiB),
    threads: cpus.length,
    cpuModel: cpus[0]?.model.trim() || '?',
    gpu: parseNvidiaGpu(gpuOut),
    diskFreeGiB: round1(free / GiB),
  };
}

export function execOrNull(cmd: string, args: readonly string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, [...args], { timeout: 5000 }, (err, stdout, stderr) => resolve(err ? null : `${stdout}\n${stderr}`));
  });
}

export function nodeHardwareDeps(): HardwareDeps {
  return {
    totalMemBytes: () => os.totalmem(),
    cpus: () => os.cpus(),
    exec: execOrNull,
    freeDiskBytes: async (dir) => { const s = await statfs(dir); return s.bavail * s.bsize; },
  };
}
