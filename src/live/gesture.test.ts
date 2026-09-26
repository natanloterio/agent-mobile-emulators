import { describe, expect, it } from 'vitest';
import { classifyGesture, contentRect, createKeyCollector, toNormalized, type Clock } from './gesture';
import type { InputGesture } from './types';

describe('contentRect (object-fit: contain; object-position: top center)', () => {
  it('caixa mais larga que o vídeo: faixas laterais, centralizado', () => {
    expect(contentRect({ width: 600, height: 800 }, { width: 1080, height: 2400 })).toEqual({ x: 120, y: 0, width: 360, height: 800 });
  });
  it('caixa mais alta que o vídeo: sobra embaixo (alinhado ao topo)', () => {
    expect(contentRect({ width: 360, height: 1000 }, { width: 1080, height: 2400 })).toEqual({ x: 0, y: 0, width: 360, height: 800 });
  });
  it('tamanho intrínseco desconhecido (0) → caixa inteira', () => {
    expect(contentRect({ width: 300, height: 600 }, { width: 0, height: 0 })).toEqual({ x: 0, y: 0, width: 300, height: 600 });
  });
});

describe('toNormalized', () => {
  const box = { width: 600, height: 800 }; const video = { width: 1080, height: 2400 };
  it('converte para 0–1 sobre a área útil', () => {
    expect(toNormalized({ x: 300, y: 400 }, box, video)).toEqual({ x: 0.5, y: 0.5 });
    expect(toNormalized({ x: 120, y: 0 }, box, video)).toEqual({ x: 0, y: 0 });
  });
  it('ponto na faixa preta → null; com clamp → preso à borda', () => {
    expect(toNormalized({ x: 50, y: 400 }, box, video)).toBeNull();
    expect(toNormalized({ x: 50, y: 900 }, box, video, { clamp: true })).toEqual({ x: 0, y: 1 });
  });
});

describe('classifyGesture', () => {
  it('curto e parado → tap no ponto do toque', () => {
    expect(classifyGesture({ x: 0.5, y: 0.5, t: 0 }, { x: 0.505, y: 0.51, t: 120 })).toEqual({ kind: 'tap', x: 0.5, y: 0.5 });
  });
  it('deslocamento ≥ 2% → swipe com a duração real', () => {
    expect(classifyGesture({ x: 0.5, y: 0.8, t: 1000 }, { x: 0.5, y: 0.2, t: 1250 }))
      .toEqual({ kind: 'swipe', x: 0.5, y: 0.8, x2: 0.5, y2: 0.2, durationMs: 250 });
  });
  it('parado mas longo (≥ 300 ms) → swipe no mesmo ponto (toque longo)', () => {
    expect(classifyGesture({ x: 0.3, y: 0.3, t: 0 }, { x: 0.3, y: 0.3, t: 800 })).toMatchObject({ kind: 'swipe', durationMs: 800 });
  });
  it('duração presa em 1–5000 ms', () => {
    expect(classifyGesture({ x: 0, y: 0, t: 0 }, { x: 1, y: 1, t: 60_000 })).toMatchObject({ durationMs: 5000 });
    expect(classifyGesture({ x: 0, y: 0, t: 10 }, { x: 1, y: 1, t: 10 })).toMatchObject({ durationMs: 1 });
  });
});

/** Relógio manual: `advance` dispara os timers vencidos. */
function manualClock() {
  let now = 0; let seq = 0; const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: Clock = {
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: (id) => { timers.delete(id as number); },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.fn(); }
  };
  return { clock, advance, pending: () => timers.size };
}

describe('createKeyCollector', () => {
  const setup = () => { const out: InputGesture[] = []; const c = manualClock(); const k = createKeyCollector((g) => out.push(g), c.clock, 250); return { out, k, ...c }; };
  const key = (k: string, mods: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {}) => ({ key: k, ...mods });

  it('acumula imprimíveis e manda um text após 250 ms sem teclas', () => {
    const { out, k, advance } = setup();
    for (const ch of 'oi ') expect(k.key(key(ch))).toBe(true);
    advance(200); expect(k.key(key('x'))).toBe(true);
    advance(200); expect(out).toEqual([]);
    advance(60); expect(out).toEqual([{ kind: 'text', text: 'oi x' }]);
  });
  it('Backspace, Enter e Escape viram teclas, depois de esvaziar o texto pendente (ordem preservada)', () => {
    const { out, k, pending } = setup();
    k.key(key('a')); k.key(key('Enter')); k.key(key('Backspace')); k.key(key('Escape'));
    expect(out).toEqual([{ kind: 'text', text: 'a' }, { kind: 'key', key: 'enter' }, { kind: 'key', key: 'del' }, { kind: 'key', key: 'back' }]);
    expect(pending()).toBe(0);
  });
  it('atalhos com Ctrl/Meta e teclas não mapeadas são ignorados (false)', () => {
    const { out, k } = setup();
    expect(k.key(key('c', { ctrlKey: true }))).toBe(false);
    expect(k.key(key('v', { metaKey: true }))).toBe(false);
    expect(k.key(key('Tab'))).toBe(false); expect(k.key(key('ArrowLeft'))).toBe(false); expect(k.key(key('Shift'))).toBe(false);
    expect(out).toEqual([]);
  });
  it('caractere fora do ASCII vai sozinho (o daemon recusa só ele, não o texto ao redor)', () => {
    const { out, k, advance } = setup();
    k.key(key('a')); k.key(key('ç')); k.key(key('b')); advance(250);
    expect(out).toEqual([{ kind: 'text', text: 'a' }, { kind: 'text', text: 'ç' }, { kind: 'text', text: 'b' }]);
  });
  it('500 caracteres esvaziam na hora; flush e dispose', () => {
    const { out, k, pending } = setup();
    for (let i = 0; i < 500; i++) k.key(key('x'));
    expect(out).toEqual([{ kind: 'text', text: 'x'.repeat(500) }]);
    k.key(key('y')); k.flush(); expect(out.at(-1)).toEqual({ kind: 'text', text: 'y' });
    k.key(key('z')); k.dispose(); expect(pending()).toBe(0); expect(out).toHaveLength(2);
  });
});
