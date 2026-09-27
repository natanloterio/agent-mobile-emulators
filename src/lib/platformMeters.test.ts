import { describe, expect, it } from 'vitest';
import { hostMetrics } from '../state/fixtures';
import { hostOs, isAppleSilicon, metersFor, vramMeasured } from './platformMeters';

const labels = (h: Parameters<typeof metersFor>[0]) => metersFor(h).map((m) => m.label);
const noGpu = { vramUsedMiB: null, vramTotalMiB: null } as const;

describe('hostOs — qual visão de recursos usar', () => {
  it('darwin → mac, win32 → windows; linux, desconhecido ou daemon antigo → linux', () => {
    expect(hostOs(hostMetrics({ platform: 'darwin' }))).toBe('mac');
    expect(hostOs(hostMetrics({ platform: 'win32' }))).toBe('windows');
    expect(hostOs(hostMetrics({ platform: 'linux' }))).toBe('linux');
    expect(hostOs(hostMetrics({ platform: 'freebsd' }))).toBe('linux');
    expect(hostOs(hostMetrics())).toBe('linux');
    expect(hostOs(null)).toBe('linux');
  });
  it('Apple Silicon = darwin + arm64', () => {
    expect(isAppleSilicon(hostMetrics({ platform: 'darwin', arch: 'arm64' }))).toBe(true);
    expect(isAppleSilicon(hostMetrics({ platform: 'darwin', arch: 'x64' }))).toBe(false);
    expect(isAppleSilicon(hostMetrics({ platform: 'linux', arch: 'arm64' }))).toBe(false);
  });
});

describe('metersFor — só o que o host consegue medir', () => {
  it('antes da 1ª amostra: RAM, CPU e VRAM em "—" (ainda conectando, não esconde nada)', () => {
    expect(metersFor(null).map((m) => m.value)).toEqual(['—', '—', '—']);
  });
  it('Linux com NVIDIA: RAM, CPU e VRAM', () => {
    expect(labels(hostMetrics({ platform: 'linux' }))).toEqual(['RAM', 'CPU', 'VRAM']);
  });
  it('Linux sem GPU mensurável: VRAM some', () => {
    expect(labels(hostMetrics({ platform: 'linux', ...noGpu }))).toEqual(['RAM', 'CPU']);
  });
  it('Windows: VRAM só com NVIDIA', () => {
    expect(labels(hostMetrics({ platform: 'win32' }))).toEqual(['RAM', 'CPU', 'VRAM']);
    expect(labels(hostMetrics({ platform: 'win32', ...noGpu }))).toEqual(['RAM', 'CPU']);
  });
  it('macOS: nunca VRAM (sem nvidia-smi; no Apple Silicon a GPU usa a própria RAM)', () => {
    expect(labels(hostMetrics({ platform: 'darwin', arch: 'arm64', ...noGpu }))).toEqual(['RAM', 'CPU']);
    expect(labels(hostMetrics({ platform: 'darwin', arch: 'x64' }))).toEqual(['RAM', 'CPU']);
  });
  it('RAM e CPU com os mesmos valores em qualquer plataforma', () => {
    const mac = metersFor(hostMetrics({ platform: 'darwin' }));
    expect(mac[0]).toEqual({ label: 'RAM', value: '40,3 / 125,6 GiB', pct: '32%' });
    expect(mac[1]).toEqual({ label: 'CPU', value: '37% · 32 threads', pct: '37%' });
  });
});

describe('vramMeasured — Provedores mostra o quadro da VRAM?', () => {
  it('sem host ainda: sim (mantém o quadro até saber)', () => {
    expect(vramMeasured(null)).toBe(true);
  });
  it('VRAM medida em Linux/Windows: sim; sem medida ou macOS: não', () => {
    expect(vramMeasured(hostMetrics({ platform: 'linux' }))).toBe(true);
    expect(vramMeasured(hostMetrics({ platform: 'win32' }))).toBe(true);
    expect(vramMeasured(hostMetrics({ platform: 'win32', ...noGpu }))).toBe(false);
    expect(vramMeasured(hostMetrics({ platform: 'darwin' }))).toBe(false);
  });
});
