import { describe, expect, it } from 'vitest';
import { hostMetrics } from '../state/fixtures';
import { hostMeters, kvCacheLeftGiB, liveHostMeters, liveVram, vramEmulatorShare } from './resources';

describe('liveHostMeters — snapshot.host medido', () => {
  it('RAM usada/total GiB, CPU %, VRAM usada/total GB', () => {
    expect(liveHostMeters(hostMetrics())).toEqual([
      { label: 'RAM', value: '40,3 / 125,6 GiB', pct: '32%' },
      { label: 'CPU', value: '37% · 32 threads', pct: '37%' },
      { label: 'VRAM', value: '20,0 / 32,0 GB', pct: '63%' },
    ]);
  });
  it('sem nvidia-smi a VRAM vira —; sem host tudo vira —', () => {
    expect(liveHostMeters(hostMetrics({ vramUsedMiB: null, vramTotalMiB: null }))[2]).toEqual({ label: 'VRAM', value: '—', pct: '0%' });
    expect(liveHostMeters(null).map((m) => m.value)).toEqual(['—', '—', '—']);
  });
  it('demo segue com as constantes do design', () => {
    expect(hostMeters(8)[0].label).toBe('RAM');
  });
});

describe('liveVram — Provedores com VRAM real', () => {
  it('KV restante = VRAM total − usada; total e fatia dos emuladores sobre o total real', () => {
    expect(liveVram(hostMetrics(), 2)).toEqual({ kvLeft: '12,0 GiB', total: '32 GB', emuShare: vramEmulatorShare(2, 32) });
    expect(vramEmulatorShare(8, 16)).toBe('32%');
  });
  it('sem VRAM medida devolve null (a tela usa a estimativa de hoje)', () => {
    expect(liveVram(hostMetrics({ vramTotalMiB: null }), 2)).toBeNull();
    expect(liveVram(null, 2)).toBeNull();
    expect(kvCacheLeftGiB(8)).toMatch(/GiB$/);
  });
});
