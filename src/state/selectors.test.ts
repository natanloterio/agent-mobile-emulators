import { describe, expect, it } from 'vitest';
import { createInitialState, fleetReducer } from './fleetReducer';
import { liveRoles } from '../live/merge';
import { decorateTile, selectRoles, selectSelStats } from './selectors';

describe('selectors — incremento 3', () => {
  it('selectRoles expõe modelos carregados e erro; sem lista, oferece o modelo atual (Review Focus 1)', () => {
    const s = fleetReducer(fleetReducer(createInitialState(), { type: 'providerModels', role: 'worker', models: ['gpt-oss:20b'] }), { type: 'providerError', role: 'esc', message: 'endpoint precisa ser http(s)' });
    const roles = selectRoles(s);
    expect(roles.find((r) => r.key === 'worker')?.models).toEqual(['gpt-oss:20b']);
    expect(roles.find((r) => r.key === 'esc')?.error).toBe('endpoint precisa ser http(s)');
    const lider = roles.find((r) => r.key === 'lider')!; expect(lider.models).toEqual([]); expect(lider.error).toBeNull();
  });
  it('liveRoles sem lista carregada não oferece rótulo do mock (models vazio)', () => {
    const snap = { killed: false, updatedAt: 'x', identities: [], providers: {
      lider: { role: 'lider', mode: 'nuvem', model: 'claude-sonnet-5', endpoint: 'anthropic', lastTest: null },
      worker: { role: 'worker', mode: 'local', model: 'qwen3.5:27b', endpoint: 'http://127.0.0.1:11434/v1', lastTest: null },
      esc: { role: 'esc', mode: 'nuvem', model: 'claude-haiku-4-5', endpoint: 'anthropic', lastTest: null },
    } } as const;
    const out = liveRoles(selectRoles(createInitialState()), snap);
    for (const r of out) expect(r.models, r.key).toEqual([]);
    expect(out.find((r) => r.key === 'worker')?.model).toBe('qwen3.5:27b');
  });
  it('custo mostra s·GPU quando há genMs; passos mostram sobra; task marca degradada', () => {
    const base = createInitialState().ids[0];
    const t = decorateTile({ ...base, cost: 0.2, genMs: 33900, degraded: true, earlyStopRemaining: 13, steps: 17, budget: 30 }, 0, false);
    expect(t.costFmt).toMatch(/33,9 s GPU/);
    expect(selectSelStats(t)[0].value).toBe('17/30 · 13 sobrando');
    expect(decorateTile({ ...base, genMs: 0 }, 0, false).costFmt).not.toMatch(/GPU/);
  });
});
