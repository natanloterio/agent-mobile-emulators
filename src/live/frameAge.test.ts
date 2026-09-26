import { describe, expect, it } from 'vitest';
import { frameAgeLabel, phoneLabel } from './frameAge';

describe('frameAgeLabel', () => {
  const t0 = Date.parse('2026-09-26T12:00:00.000Z');
  it('ao vivo, segundos, minutos, inválido', () => {
    expect(frameAgeLabel(t0, t0 + 900)).toBe('vídeo · ao vivo');
    expect(frameAgeLabel('2026-09-26T12:00:00.000Z', t0 + 7_000)).toBe('há 7 s');
    expect(frameAgeLabel(t0, t0 + 150_000)).toBe('há 2 min');
    expect(frameAgeLabel('lixo', t0)).toBe('vídeo');
  });
});

describe('phoneLabel', () => {
  const t0 = Date.parse('2026-09-26T12:00:00.000Z');
  it('streaming é ao vivo mesmo com quadro antigo (tela parada não gera pacote)', () => {
    expect(phoneLabel({ video: 'streaming', videoAt: t0, now: t0 + 60_000, fallback: '320p' })).toBe('vídeo · ao vivo');
    expect(phoneLabel({ video: 'streaming', videoAt: null, screenAt: '2026-09-26T11:00:00.000Z', now: t0, fallback: '320p' })).toBe('vídeo · ao vivo');
  });
  it('fora de streaming: idade do quadro decodificado, senão do poster', () => {
    expect(phoneLabel({ video: 'retrying', videoAt: t0, now: t0 + 7_000, fallback: '320p' })).toBe('há 7 s');
    expect(phoneLabel({ video: 'idle', videoAt: null, screenAt: '2026-09-26T12:00:00.000Z', now: t0 + 3_000, fallback: '320p' })).toBe('há 3 s');
  });
  it('sem estado de vídeo e sem quadros: rótulo padrão', () => {
    expect(phoneLabel({ videoAt: null, now: t0, fallback: '320p · 4 fps' })).toBe('320p · 4 fps');
  });
});
