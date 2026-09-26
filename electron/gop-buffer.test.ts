import { describe, expect, it } from 'vitest';
import { createGopBuffer } from './gop-buffer.js';

const p = (id: string, seq: number, key: boolean) => ({ id, seq, key, nal: 'x' });
describe('createGopBuffer', () => {
  it('reinicia no key por id, ignora não-key antes do primeiro key e reproduz na ordem', () => {
    const g = createGopBuffer();
    g.push(p('a', 0, false)); g.push(p('a', 1, true)); g.push(p('a', 2, false)); g.push(p('b', 0, true)); g.push(p('a', 3, true)); g.push(p('a', 4, false)); g.push(p('b', 1, false));
    expect(g.replay()).toEqual([p('a', 3, true), p('a', 4, false), p('b', 0, true), p('b', 1, false)]);
  });
  it('limita o GOP a MAX_GOP pacotes (descarta os mais antigos após o key)', () => {
    const g = createGopBuffer(3); g.push(p('a', 0, true)); for (let i = 1; i <= 5; i++) g.push(p('a', i, false));
    expect(g.replay().map((x) => (x as { seq: number }).seq)).toEqual([0, 4, 5]);
  });
});
