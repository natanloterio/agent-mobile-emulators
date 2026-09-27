import { describe, expect, it } from 'vitest';
import { createHostMetrics, cpuPctBetween, isRelevantChange, parseMeminfo, parseNvidiaSmi, parseProcStat } from '../src/host/metrics.js';
import type { HostMetrics } from '../src/server/snapshot.js';

const MEMINFO = 'MemTotal:       131072000 kB\nMemFree:         2000000 kB\nMemAvailable:   104857600 kB\nBuffers: 1 kB\n';
const stat = (user: number, idle: number, iowait = 0) => `cpu  ${user} 0 0 ${idle} ${iowait} 0 0 0 0 0\ncpu0 1 2 3 4 5 6 7 8 0 0\n`;

describe('parsers do host', () => {
  it('meminfo: total e disponível em KiB; sem MemAvailable → null', () => {
    expect(parseMeminfo(MEMINFO)).toEqual({ totalKiB: 131072000, availableKiB: 104857600 });
    expect(parseMeminfo('MemTotal: 10 kB\n')).toBeNull();
  });
  it('/proc/stat: idle inclui iowait; linha ausente → null', () => {
    expect(parseProcStat(stat(100, 800, 100))).toEqual({ idle: 900, total: 1000 });
    expect(parseProcStat('intr 1 2 3')).toBeNull();
  });
  it('CPU% pela diferença entre amostras; sem avanço → 0', () => {
    expect(cpuPctBetween({ idle: 900, total: 1000 }, { idle: 1650, total: 2000 })).toBe(25);
    expect(cpuPctBetween({ idle: 1, total: 1 }, { idle: 1, total: 1 })).toBe(0);
  });
  it('nvidia-smi: soma as GPUs; saída inválida → null', () => {
    expect(parseNvidiaSmi('16126, 32607\n')).toEqual({ usedMiB: 16126, totalMiB: 32607 });
    expect(parseNvidiaSmi('100, 200\n50, 300\n')).toEqual({ usedMiB: 150, totalMiB: 500 });
    expect(parseNvidiaSmi('NVIDIA-SMI has failed')).toBeNull();
    expect(parseNvidiaSmi('')).toBeNull();
  });
  it('mudança relevante: RAM ≥ 0,5 GiB, CPU ≥ 5 pontos, VRAM ≥ 256 MiB', () => {
    const a: HostMetrics = { ramUsedGiB: 10, ramTotalGiB: 125, cpuPct: 10, threads: 32, vramUsedMiB: 1000, vramTotalMiB: 32000, at: 'x' };
    expect(isRelevantChange(null, a)).toBe(true);
    expect(isRelevantChange(a, { ...a, at: 'y', ramUsedGiB: 10.2, cpuPct: 12 })).toBe(false);
    expect(isRelevantChange(a, { ...a, ramUsedGiB: 10.6 })).toBe(true);
    expect(isRelevantChange(a, { ...a, cpuPct: 16 })).toBe(true);
    expect(isRelevantChange(a, { ...a, vramUsedMiB: 1300 })).toBe(true);
    expect(isRelevantChange(a, { ...a, vramUsedMiB: null })).toBe(true);
  });
});

describe('createHostMetrics', () => {
  function harness(opts: { smi?: () => Promise<string> } = {}) {
    let statText = stat(100, 900);
    const files: Record<string, () => string> = { '/proc/meminfo': () => MEMINFO, '/proc/stat': () => statText };
    const m = createHostMetrics({
      readFile: (p) => { const f = files[p]; if (!f) throw new Error(`ENOENT ${p}`); return f(); },
      nvidiaSmi: opts.smi ?? (async () => '16126, 32607\n'),
      threads: () => 32, now: () => new Date('2026-09-26T12:00:00Z'),
    });
    return { m, setStat: (s: string) => { statText = s; } };
  }
  it('read() antes da 1ª amostra é null; sample() preenche o cache', async () => {
    const { m, setStat } = harness();
    expect(m.read()).toBeNull();
    await m.sample();
    setStat(stat(600, 1400));
    const got = await m.sample();
    expect(got).toEqual({ ramUsedGiB: 25, ramTotalGiB: 125, cpuPct: 50, threads: 32, vramUsedMiB: 16126, vramTotalMiB: 32607, at: '2026-09-26T12:00:00.000Z' });
    expect(m.read()).toEqual(got);
  });
  it('nvidia-smi ausente/erro → VRAM null, resto segue', async () => {
    const { m } = harness({ smi: async () => { throw new Error('ENOENT nvidia-smi'); } });
    const got = await m.sample();
    expect(got).toMatchObject({ vramUsedMiB: null, vramTotalMiB: null, threads: 32, cpuPct: 0 });
  });
  it('/proc ilegível → amostra falha sem derrubar e o cache anterior fica', async () => {
    let broken = false;
    const m = createHostMetrics({
      readFile: (p) => { if (broken) throw new Error('EACCES'); return p === '/proc/meminfo' ? MEMINFO : stat(1, 1); },
      nvidiaSmi: async () => '', threads: () => 4,
    });
    const first = await m.sample();
    broken = true;
    await expect(m.sample()).rejects.toThrow('EACCES');
    expect(m.read()).toEqual(first);
  });
  it('start() amostra no intervalo e só avisa em mudança relevante; stop() para', async () => {
    const ticks: (() => void)[] = []; let cleared = 0;
    let statText = stat(100, 900); let changes = 0;
    const m = createHostMetrics({
      readFile: (p) => (p === '/proc/meminfo' ? MEMINFO : statText), nvidiaSmi: async () => '', threads: () => 8,
      setInterval: (fn) => { ticks.push(fn); return 1 as unknown as NodeJS.Timeout; }, clearInterval: () => { cleared += 1; },
    });
    m.start(() => { changes += 1; });
    await m.idle();
    expect(changes).toBe(1); // primeira amostra sempre é relevante
    ticks[0](); await m.idle();
    expect(changes).toBe(1); // nada mudou
    statText = stat(1100, 900); ticks[0](); await m.idle();
    expect(changes).toBe(2); // CPU foi a 100%
    m.stop(); expect(cleared).toBe(1);
  });
});

describe('fatias da GPU no coletor (integrador)', () => {
  it('mede as fatias no máximo a cada gpuEveryMs e as publica no snapshot', async () => {
    let t = 0; let calls = 0;
    const slices = [{ kind: 'model' as const, label: 'm · Ollama', usedMiB: 100 }];
    const h = createHostMetrics({
      readFile: (p) => (p === '/proc/meminfo' ? 'MemTotal: 1048576 kB\nMemAvailable: 524288 kB\n' : 'cpu 1 0 1 10 0 0 0 0\n'),
      nvidiaSmi: async () => '500, 1000', threads: () => 4, now: () => new Date(t),
      gpu: async (total) => { calls += 1; return { ...total, slices }; }, gpuEveryMs: 10_000,
    });
    const a = await h.sample();
    expect(a.gpu).toMatchObject({ usedMiB: 500, totalMiB: 1000, slices });
    t = 2_000; await h.sample(); expect(calls).toBe(1);
    t = 12_000; await h.sample(); expect(calls).toBe(2);
  });
});
