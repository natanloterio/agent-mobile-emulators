import { execFile } from 'node:child_process';
import { statfs } from 'node:fs/promises';
import os from 'node:os';
import type { PlatformId } from './platform.js';
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
  return { name: name.replace(/^NVIDIA\s+(GeForce\s+)?/, ''), totalGiB: round1(n / 1024), unified: false };
}

export async function readHardware(home: string, d: HardwareDeps, platform: PlatformId): Promise<Hardware> {
  const cpus = d.cpus();
  const ramGiB = round1(d.totalMemBytes() / GiB);
  const cpuModel = cpus[0]?.model.trim() || '?';
  if (platform === 'darwin-arm64') {
    const free = await d.freeDiskBytes(home).catch(() => 0);
    return {
      ramGiB, threads: cpus.length, cpuModel,
      // Metal usa a memória unificada; cerca de 2/3 ficam para o modelo.
      gpu: { name: 'Apple Silicon', totalGiB: round1((ramGiB * 2) / 3), unified: true },
      diskFreeGiB: round1(free / GiB),
    };
  }
  const [gpuOut, free] = await Promise.all([
    d.exec('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']),
    d.freeDiskBytes(home).catch(() => 0),
  ]);
  return {
    ramGiB, threads: cpus.length, cpuModel,
    gpu: parseNvidiaGpu(gpuOut),
    diskFreeGiB: round1(free / GiB),
  };
}

/** stdout+stderr, ou null se falhou; `timeoutMs` padrão 5 s. Sem janela de console no Windows. */
export function execOrNull(cmd: string, args: readonly string[], timeoutMs = 5000): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, [...args], { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => resolve(err ? null : `${stdout}\n${stderr}`));
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
