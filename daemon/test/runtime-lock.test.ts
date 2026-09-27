import { describe, expect, it } from 'vitest';
import { createRuntimeLock } from '../src/swarm/runtime-lock.js';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('createRuntimeLock', () => {
  it('serializa: a segunda chamada só roda depois que a primeira termina (FIFO)', async () => {
    const lock = createRuntimeLock();
    const events: string[] = [];
    const a = lock.run(async () => { events.push('a-start'); await wait(20); events.push('a-end'); return 'a'; });
    const b = lock.run(async () => { events.push('b-start'); await wait(1); events.push('b-end'); return 'b'; });
    expect(await Promise.all([a, b])).toEqual(['a', 'b']);
    expect(events).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });
  it('uma falha não trava as próximas chamadas', async () => {
    const lock = createRuntimeLock();
    const a = lock.run(async () => { throw new Error('boom'); });
    const b = lock.run(async () => 'ok');
    await expect(a).rejects.toThrow('boom');
    expect(await b).toBe('ok');
  });
  it('três chamadas concorrentes rodam uma de cada vez, na ordem de chegada', async () => {
    const lock = createRuntimeLock();
    const order: number[] = [];
    const mk = (n: number) => lock.run(async () => { order.push(n); await wait(5); return n; });
    await Promise.all([mk(1), mk(2), mk(3)]);
    expect(order).toEqual([1, 2, 3]);
  });
});
