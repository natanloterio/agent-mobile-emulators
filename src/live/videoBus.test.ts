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

describe('createVideoBus — GOP por id reenviado a quem assina tarde', () => {
  const pk = (id: string, seq: number, key = false) => ({ id, seq, key, nal: 'x' });
  it('assinante tardio recebe key + deltas do GOP atual em ordem, depois os pacotes ao vivo', () => {
    const bus = createVideoBus(); const got: number[] = [];
    bus.publish(pk('a', 1, true)); bus.publish(pk('a', 2)); bus.publish(pk('a', 3)); bus.publish(pk('b', 9, true));
    bus.subscribe('a', (p) => got.push(p.seq));
    expect(got).toEqual([1, 2, 3]);
    bus.publish(pk('a', 4)); expect(got).toEqual([1, 2, 3, 4]);
  });
  it('não guarda delta antes de qualquer key; key novo reinicia o GOP', () => {
    const bus = createVideoBus(); const got: number[] = [];
    bus.publish(pk('a', 1)); const off = bus.subscribe('a', (p) => got.push(p.seq)); off();
    expect(got).toEqual([]);
    bus.publish(pk('a', 2, true)); bus.publish(pk('a', 3)); bus.publish(pk('a', 4, true)); bus.publish(pk('a', 5));
    const late: number[] = []; bus.subscribe('a', (p) => late.push(p.seq));
    expect(late).toEqual([4, 5]);
  });
  it('limite: GOP que passaria do limite é descartado inteiro; o próximo key o reinicia', () => {
    const bus = createVideoBus(3); const got: number[] = [];
    bus.publish(pk('a', 1, true)); bus.publish(pk('a', 2)); bus.publish(pk('a', 3)); bus.publish(pk('a', 4)); bus.publish(pk('a', 5));
    const off = bus.subscribe('a', (p) => got.push(p.seq)); off();
    expect(got).toEqual([]);
    bus.publish(pk('a', 6, true)); bus.publish(pk('a', 7));
    bus.subscribe('a', (p) => got.push(p.seq));
    expect(got).toEqual([6, 7]);
  });
  it('o GOP sobrevive à saída de todos os assinantes', () => {
    const bus = createVideoBus(); const off = bus.subscribe('a', () => undefined);
    bus.publish(pk('a', 1, true)); off();
    const got: number[] = []; bus.subscribe('a', (p) => got.push(p.seq));
    expect(got).toEqual([1]);
  });
});
