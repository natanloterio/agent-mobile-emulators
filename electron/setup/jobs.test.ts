import { describe, expect, it } from 'vitest';
import { runJobs } from './jobs';
import type { JobRunners } from './runners';
import type { JobEvent } from './types';

const noop = async () => {};
const runners = (over: Partial<JobRunners> = {}): JobRunners => ({ sdk: noop, adb: noop, emu: noop, img: noop, ollama: noop, model: noop, ...over });

describe('runJobs', () => {
  it('põe tudo na fila, roda na ordem fixa e termina cada um em done', async () => {
    const order: string[] = [];
    const events: JobEvent[] = [];
    await runJobs(['model', 'img'], runners({
      img: async (p) => { order.push('img'); p(800, 1600); p(1600, 1600); },
      model: async (p) => { order.push('model'); p(14000, 14000); },
    }), (e) => events.push(e), () => 0);
    expect(order).toEqual(['img', 'model']);
    expect(events.slice(0, 2).map((e) => [e.id, e.state])).toEqual([['img', 'wait'], ['model', 'wait']]);
    expect(events.filter((e) => e.state === 'done').map((e) => [e.id, e.doneMb, e.totalMb])).toEqual([['img', 1600, 1600], ['model', 14000, 14000]]);
  });
  it('erro para a fila: o item vira err com o tipo, os seguintes ficam em wait', async () => {
    const events: JobEvent[] = [];
    await runJobs(['ollama', 'model'], runners({
      ollama: async (p) => { p(700, 1428); throw Object.assign(new Error('write'), { code: 'ENOSPC' }); },
      model: async () => { throw new Error('não devia rodar'); },
    }), (e) => events.push(e), () => 0);
    const last = events.at(-1)!;
    expect(last).toMatchObject({ id: 'ollama', state: 'err', doneMb: 700, totalMb: 1428, error: { kind: 'disk-full' } });
    expect(events.some((e) => e.id === 'model' && e.state === 'run')).toBe(false);
  });
  it('limita eventos de progresso a um a cada 200 ms (menos o último)', async () => {
    const events: JobEvent[] = [];
    let t = 0;
    await runJobs(['img'], runners({ img: async (p) => { for (let i = 1; i <= 100; i++) { t += 10; p(i * 16, 1600); } } }), (e) => events.push(e), () => t);
    const runs = events.filter((e) => e.state === 'run');
    expect(runs.length).toBeLessThanOrEqual(8);
    expect(events.at(-1)).toMatchObject({ state: 'done', doneMb: 1600 });
  });
});
