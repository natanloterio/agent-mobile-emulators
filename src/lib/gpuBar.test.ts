import { describe, expect, it } from 'vitest';
import { createI18n } from '../i18n/translate';
import type { GpuBreakdown } from '../live/types';
import { gpuBar } from './gpuBar';

const gpu = (over: Partial<GpuBreakdown> = {}): GpuBreakdown => ({
  totalMiB: 32607, usedMiB: 25857, at: '2026-09-27T10:00:00Z',
  slices: [
    { kind: 'other', label: 'Sistema', usedMiB: 1300 },
    { kind: 'emulators', label: 'Emuladores', usedMiB: 1463 },
    { kind: 'model', label: 'gpt-oss:20b · Ollama', usedMiB: 13664, runtime: 'ollama' },
    { kind: 'model', label: 'gemma4:12b-instruct · LM Studio', usedMiB: 9430, runtime: 'lmstudio' },
  ],
  ...over,
});
const widthOf = (s: { width: string }) => Number.parseFloat(s.width);

describe('gpuBar — VRAM real por consumidor', () => {
  it('sem medida (ou total zero) devolve null', () => {
    expect(gpuBar(null)).toBeNull();
    expect(gpuBar(undefined)).toBeNull();
    expect(gpuBar(gpu({ totalMiB: 0 }))).toBeNull();
  });
  it('ordena modelos, emuladores, outros e fecha com livre; GB com uma casa', () => {
    const v = gpuBar(gpu())!;
    expect(v.total).toBe('31,8');
    expect(v.free).toBe('6,6');
    expect(v.segments.map((s) => [s.kind, s.gb])).toEqual([
      ['model', '13,3'], ['model', '9,2'], ['emulators', '1,4'], ['other', '1,3'], ['free', '6,6'],
    ]);
    expect(v.segments[0].label).toBe('gpt-oss:20b · Ollama');
    expect(v.segments[0].width).toBe('41.90%');
  });
  it('modelos ganham tons distintos em sequência', () => {
    expect(gpuBar(gpu())!.segments.filter((s) => s.kind === 'model').map((s) => s.tone)).toEqual([0, 1]);
  });
  it('fatias abaixo de 1,5 % ficam na legenda sem texto na barra', () => {
    const v = gpuBar(gpu({ slices: [{ kind: 'emulators', label: 'Emuladores', usedMiB: 300 }, { kind: 'other', label: 'Sistema', usedMiB: 900 }], usedMiB: 1200 }))!;
    expect(v.segments.map((s) => s.inBar)).toEqual([false, true, true]);
  });
  it('nunca soma mais de 100 %, mesmo com fatias acima do usado', () => {
    const v = gpuBar(gpu({ totalMiB: 10000, usedMiB: 9000, slices: [{ kind: 'model', label: 'm', usedMiB: 8000 }, { kind: 'other', label: 'o', usedMiB: 4000 }] }))!;
    const sum = v.segments.reduce((a, s) => a + widthOf(s), 0);
    expect(sum).toBeLessThanOrEqual(100);
    expect(v.segments.find((s) => s.kind === 'free')!.width).toBe('0.00%');
  });
  it('livre nunca é negativo e segue o formato do idioma', () => {
    const v = gpuBar(gpu({ usedMiB: 40000 }), createI18n('en'))!;
    expect(v.free).toBe('0.0');
    expect(v.total).toBe('31.8');
  });
});
