import { describe, expect, it } from 'vitest';
import { createVideoBus } from './videoBus';

describe('createVideoBus', () => {
  it('entrega por id, cancela a assinatura e ignora ids sem assinante', () => {
    const bus = createVideoBus(); const a: number[] = []; const b: number[] = [];
    const offA = bus.subscribe('a', (p) => a.push(p.seq)); bus.subscribe('b', (p) => b.push(p.seq));
    bus.publish({ id: 'a', seq: 1, key: true, nal: 'x' }); bus.publish({ id: 'b', seq: 2, key: true, nal: 'x' }); bus.publish({ id: 'c', seq: 3, key: true, nal: 'x' });
    offA(); bus.publish({ id: 'a', seq: 4, key: false, nal: 'x' });
    expect(a).toEqual([1]); expect(b).toEqual([2]);
  });
});
