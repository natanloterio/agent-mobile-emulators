import { describe, expect, it } from 'vitest';
import { IDENTITIES } from '../data/identities';
import { mergeLive } from './merge';

const live = {
  killed: false, updatedAt: 'x',
  identities: [{ id: 'conta1', name: 'conta1', handle: '@p1t41a.meta.test', state: 'needs-human', task: 'Levantar comentários', steps: 12, budget: 30, costUsd: 0.07, error: 'checkpoint', lastTools: [] }],
};

describe('mergeLive', () => {
  it('sem snapshot devolve o mock intacto', () => {
    expect(mergeLive(IDENTITIES, null)).toBe(IDENTITIES);
  });
  it('sobrepõe só a identidade 0 e traduz needs-human → needs', () => {
    const out = mergeLive(IDENTITIES, live);
    expect(out[0]).toMatchObject({ handle: '@p1t41a.meta.test', state: 'needs', steps: 12, budget: 30, error: 'checkpoint' });
    expect(out[1]).toBe(IDENTITIES[1]);
    expect(IDENTITIES[0].handle).toBe('@aurora.moda');
  });
  it('traduz offline e idle/running/logged-in', () => {
    const st = (s: string) => mergeLive(IDENTITIES, { ...live, identities: [{ ...live.identities[0], state: s }] })[0].state;
    expect(st('offline')).toBe('offline'); expect(st('running')).toBe('running'); expect(st('logged-in')).toBe('idle'); expect(st('idle')).toBe('idle');
  });
});
