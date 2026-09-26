import { describe, expect, it } from 'vitest';
import { createInitialState, fleetReducer } from './fleetReducer';
import { decorateTile, selectRoles, selectSelStats } from './selectors';

describe('selectors — incremento 3', () => {
  it('selectRoles expõe modelos carregados e erro; sem lista, oferece o modelo atual (Review Focus 1)', () => {
    const s = fleetReducer(fleetReducer(createInitialState(), { type: 'providerModels', role: 'worker', models: ['gpt-oss:20b'] }), { type: 'providerError', role: 'esc', message: 'endpoint precisa ser http(s)' });
    const roles = selectRoles(s);
    expect(roles.find((r) => r.key === 'worker')?.models).toEqual(['gpt-oss:20b']);
    expect(roles.find((r) => r.key === 'esc')?.error).toBe('endpoint precisa ser http(s)');
    const lider = roles.find((r) => r.key === 'lider')!; expect(lider.models).toEqual([lider.model]); expect(lider.error).toBeNull();
  });
  it('custo mostra s·GPU quando há genMs; passos mostram sobra; task marca degradada', () => {
    const base = createInitialState().ids[0];
    const t = decorateTile({ ...base, cost: 0.2, genMs: 33900, degraded: true, earlyStopRemaining: 13, steps: 17, budget: 30 }, 0, false);
    expect(t.costFmt).toMatch(/33,9 s GPU/);
    expect(selectSelStats(t)[0].value).toBe('17/30 · 13 sobrando');
    expect(decorateTile({ ...base, genMs: 0 }, 0, false).costFmt).not.toMatch(/GPU/);
  });
});
