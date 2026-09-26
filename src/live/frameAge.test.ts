import { describe, expect, it } from 'vitest';
import { frameAgeLabel } from './frameAge';

describe('frameAgeLabel', () => {
  const t0 = Date.parse('2026-09-26T12:00:00.000Z');
  it('ao vivo, segundos, minutos, inválido', () => {
    expect(frameAgeLabel(t0, t0 + 900)).toBe('vídeo · ao vivo');
    expect(frameAgeLabel('2026-09-26T12:00:00.000Z', t0 + 7_000)).toBe('há 7 s');
    expect(frameAgeLabel(t0, t0 + 150_000)).toBe('há 2 min');
    expect(frameAgeLabel('lixo', t0)).toBe('vídeo');
  });
});
