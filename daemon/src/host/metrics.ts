import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import type { GpuBreakdown, HostMetrics } from '../server/snapshot.js';

/** Métricas do host para a sidebar (spec inc. 5 §3.1): RAM, CPU, threads e VRAM medidos, nunca constantes. */
export interface CpuTimes { readonly idle: number; readonly total: number }
export interface HostMetricsDeps {
  readonly readFile?: (path: string) => string;
  /** Saída crua de `nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits`. */
  readonly nvidiaSmi?: () => Promise<string>;
  readonly threads?: () => number;
  /** SO do host; fora do Linux não há /proc e RAM/CPU vêm do módulo `os`. */
  readonly platform?: NodeJS.Platform;
  readonly arch?: string;
  readonly cpus?: () => readonly Pick<os.CpuInfo, 'times'>[];
  readonly totalMem?: () => number;
  readonly freeMem?: () => number;
  /** Fatias da VRAM por consumidor (host/gpu.ts); ausente = só o total. */
  readonly gpu?: (total: { usedMiB: number; totalMiB: number }) => Promise<Omit<GpuBreakdown, 'at'> | null>;
  /** Intervalo mínimo entre medições por processo (spawna nvidia-smi e às vezes lms). */
  readonly gpuEveryMs?: number;
  readonly now?: () => Date;
  readonly intervalMs?: number;
  readonly setInterval?: (fn: () => void, ms: number) => NodeJS.Timeout;
  readonly clearInterval?: (t: NodeJS.Timeout) => void;
}
export interface HostMetricsSampler {
  /** Última amostra (síncrono, do cache); null antes da primeira. */
  read(): HostMetrics | null;
  sample(): Promise<HostMetrics>;
  /** Amostra agora e a cada `intervalMs`; `onChange` só quando a mudança é relevante (evita broadcast a cada 2 s). */
  start(onChange: (m: HostMetrics) => void): void;
  stop(): void;
  /** Resolve quando a amostra em voo (se houver) termina. Útil em teste. */
  idle(): Promise<void>;
}

const KIB_PER_GIB = 1024 * 1024;
const RELEVANT = { ramGiB: 0.5, cpuPct: 5, vramMiB: 256 } as const;
const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

export function parseMeminfo(text: string): { totalKiB: number; availableKiB: number } | null {
  const get = (k: string) => { const m = new RegExp(`^${k}:\\s+(\\d+)\\s*kB`, 'm').exec(text); return m ? Number(m[1]) : null; };
  const totalKiB = get('MemTotal'); const availableKiB = get('MemAvailable');
  return totalKiB === null || availableKiB === null ? null : { totalKiB, availableKiB };
}

/** Linha agregada `cpu` de /proc/stat; ocioso = idle + iowait. */
export function parseProcStat(text: string): CpuTimes | null {
  const m = /^cpu\s+([\d\s]+)$/m.exec(text);
  if (!m) return null;
  const f = m[1].trim().split(/\s+/).map(Number);
  if (f.length < 4 || f.some((n) => !Number.isFinite(n))) return null;
  // guest/guest_nice (campos 9 e 10) já estão contados em user/nice.
  const total = f.slice(0, 8).reduce((a, b) => a + b, 0);
  return { idle: f[3] + (f[4] ?? 0), total };
}

/** Tempos somados de todos os núcleos (`os.cpus()`): o equivalente portátil da linha `cpu` de /proc/stat. */
export function cpuTimesFromOs(cpus: readonly Pick<os.CpuInfo, 'times'>[]): CpuTimes | null {
  if (cpus.length === 0) return null;
  return cpus.reduce((acc, { times: t }) => ({
    idle: acc.idle + t.idle,
    total: acc.total + t.user + t.nice + t.sys + t.idle + t.irq,
  }), { idle: 0, total: 0 });
}

export function cpuPctBetween(a: CpuTimes, b: CpuTimes): number {
  const dt = b.total - a.total;
  if (dt <= 0) return 0;
  return round(Math.min(100, Math.max(0, (1 - (b.idle - a.idle) / dt) * 100)), 1);
}

export function parseNvidiaSmi(out: string): { usedMiB: number; totalMiB: number } | null {
  const rows = out.trim().split('\n').filter(Boolean).map((l) => l.split(',').map((x) => Number(x.trim())));
  if (rows.length === 0 || rows.some((r) => r.length !== 2 || r.some((n) => !Number.isFinite(n)))) return null;
  return rows.reduce((acc, [u, t]) => ({ usedMiB: acc.usedMiB + u, totalMiB: acc.totalMiB + t }), { usedMiB: 0, totalMiB: 0 });
}

export function isRelevantChange(prev: HostMetrics | null, next: HostMetrics): boolean {
  if (!prev) return true;
  if ((prev.vramUsedMiB === null) !== (next.vramUsedMiB === null)) return true;
  return Math.abs(prev.ramUsedGiB - next.ramUsedGiB) >= RELEVANT.ramGiB
    || Math.abs(prev.cpuPct - next.cpuPct) >= RELEVANT.cpuPct
    || Math.abs((prev.vramUsedMiB ?? 0) - (next.vramUsedMiB ?? 0)) >= RELEVANT.vramMiB
    || prev.threads !== next.threads || prev.ramTotalGiB !== next.ramTotalGiB
    || gpuChanged(prev.gpu ?? null, next.gpu ?? null);
}

/** Mudou o conjunto de consumidores (modelo carregado/descarregado) ou algum deles em ≥ 256 MiB. */
function gpuChanged(a: GpuBreakdown | null, b: GpuBreakdown | null): boolean {
  if (!a || !b) return a !== b;
  if (a.slices.length !== b.slices.length) return true;
  return a.slices.some((s, i) => s.label !== b.slices[i].label || Math.abs(s.usedMiB - b.slices[i].usedMiB) >= RELEVANT.vramMiB);
}

const defaultNvidiaSmi = () => new Promise<string>((resolve, reject) => {
  execFile('nvidia-smi', ['--query-gpu=memory.used,memory.total', '--format=csv,noheader,nounits'], { timeout: 3000, windowsHide: true },
    (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
});

export function createHostMetrics(deps: HostMetricsDeps = {}): HostMetricsSampler {
  const readFile = deps.readFile ?? ((p: string) => readFileSync(p, 'utf8'));
  const nvidiaSmi = deps.nvidiaSmi ?? defaultNvidiaSmi;
  const threads = deps.threads ?? (() => os.cpus().length);
  const platform = deps.platform ?? process.platform;
  const arch = deps.arch ?? process.arch;
  const hasProc = platform === 'linux';
  const cpus = deps.cpus ?? (() => os.cpus());
  const totalMem = deps.totalMem ?? (() => os.totalmem());
  const freeMem = deps.freeMem ?? (() => os.freemem());
  const now = deps.now ?? (() => new Date());
  const setIv = deps.setInterval ?? ((fn, ms) => setInterval(fn, ms));
  const clearIv = deps.clearInterval ?? ((t) => clearInterval(t));
  let last: HostMetrics | null = null;
  let prevCpu: CpuTimes | null = null;
  let inFlight: Promise<unknown> | null = null;
  let timer: NodeJS.Timeout | null = null;
  let gpu: GpuBreakdown | null = null; let gpuAt = Number.NEGATIVE_INFINITY;
  const gpuEvery = deps.gpuEveryMs ?? 10_000;

  const osRam = () => ({ total: totalMem() / 1024 / KIB_PER_GIB, used: (totalMem() - freeMem()) / 1024 / KIB_PER_GIB });
  const ram = () => {
    if (!hasProc) return osRam();
    const mem = parseMeminfo(readFile('/proc/meminfo'));
    // Sem /proc/meminfo legível: `os` (freemem subestima o disponível, mas é melhor que nada).
    return mem ? { total: mem.totalKiB / KIB_PER_GIB, used: (mem.totalKiB - mem.availableKiB) / KIB_PER_GIB } : osRam();
  };
  const cpuTimes = () => (hasProc ? parseProcStat(readFile('/proc/stat')) : cpuTimesFromOs(cpus()));
  const vram = async () => { try { return parseNvidiaSmi(await nvidiaSmi()); } catch { return null; } };

  const sample = async (): Promise<HostMetrics> => {
    const r = ram();
    const cpu = cpuTimes();
    const cpuPct = cpu && prevCpu ? cpuPctBetween(prevCpu, cpu) : 0;
    if (cpu) prevCpu = cpu;
    const v = await vram();
    if (deps.gpu && v && now().getTime() - gpuAt >= gpuEvery) {
      gpuAt = now().getTime();
      const g = await deps.gpu(v).catch(() => null);
      gpu = g ? { ...g, at: now().toISOString() } : null;
    }
    last = {
      ramUsedGiB: round(r.used, 2), ramTotalGiB: round(r.total, 2), cpuPct, threads: threads(),
      vramUsedMiB: v?.usedMiB ?? null, vramTotalMiB: v?.totalMiB ?? null, at: now().toISOString(),
      platform, arch,
      ...(deps.gpu ? { gpu: v ? gpu : null } : {}),
    };
    return last;
  };

  const tick = (onChange: (m: HostMetrics) => void) => {
    if (inFlight) return; // nvidia-smi lento não empilha amostras
    const before = last;
    inFlight = sample()
      .then((m) => { if (isRelevantChange(before, m)) onChange(m); })
      .catch((e: unknown) => console.error('[host] amostra falhou:', (e as Error).message))
      .finally(() => { inFlight = null; });
  };

  return {
    read: () => last,
    sample,
    start: (onChange) => {
      if (timer) return;
      tick(onChange);
      timer = setIv(() => tick(onChange), deps.intervalMs ?? 2000);
    },
    stop: () => { if (timer) { clearIv(timer); timer = null; } },
    idle: async () => { await inFlight; },
  };
}
