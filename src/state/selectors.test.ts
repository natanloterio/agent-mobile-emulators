import { describe, expect, it } from 'vitest';
import { createInitialState, fleetReducer } from './fleetReducer';
import { liveRoles } from '../live/merge';
import { byAttention, decorateTile, selectGoalStats, selectNeedsCount, selectNeedsList, selectRoles, selectSelStats } from './selectors';
import { shouldSubmitEndpoint } from '../screens/endpointSubmit';

describe('selectors — incremento 3', () => {
  it('selectRoles expõe modelos carregados e erro; sem lista, oferece o modelo atual (Review Focus 1)', () => {
    const s = fleetReducer(fleetReducer(createInitialState(), { type: 'providerModels', role: 'worker', models: ['gpt-oss:20b'] }), { type: 'providerError', role: 'esc', message: 'endpoint precisa ser http(s)' });
    const roles = selectRoles(s);
    expect(roles.find((r) => r.key === 'worker')?.models).toEqual(['gpt-oss:20b']);
    expect(roles.find((r) => r.key === 'esc')?.error).toBe('endpoint precisa ser http(s)');
    const lider = roles.find((r) => r.key === 'lider')!; expect(lider.models).toEqual([]); expect(lider.error).toBeNull();
  });
  it('selectRoles repassa o catálogo local do papel; sem ele, catalog null e runtime null', () => {
    const runtimes = [{ kind: 'ollama', label: 'Ollama', endpoint: 'http://127.0.0.1:11434/v1', installed: true, running: true, error: null }] as const;
    const s = fleetReducer(createInitialState(), { type: 'providerModels', role: 'worker', models: [], entries: [], runtimes });
    const roles = selectRoles(s);
    expect(roles.find((r) => r.key === 'worker')?.catalog).toEqual({ entries: [], runtimes });
    const lider = roles.find((r) => r.key === 'lider')!; expect(lider.catalog).toBeNull(); expect(lider.runtime).toBeNull();
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
  it('orçamento desligado (budget null): passos mostram só o contador, sem sobra', () => {
    const base = createInitialState().ids[0];
    const t = decorateTile({ ...base, steps: 17, budget: null, earlyStopRemaining: 13 }, 0, false);
    expect(selectSelStats(t)[0].value).toBe('17');
  });
  it('card mostra erro de PUT antes do erro de carga; só o de PUT decide o reenvio do endpoint', () => {
    const ollama = 'Ollama parado — o próximo teste ou objetivo o sobe';
    const s1 = fleetReducer(createInitialState(), { type: 'providerModelsError', role: 'worker', message: ollama });
    const w1 = selectRoles(s1).find((r) => r.key === 'worker')!;
    expect(w1.error).toBe(ollama); expect(w1.putError).toBeNull();
    // Blur com o valor intacto não reenvia: o PUT limparia o erro de PUT, não o "Ollama parado".
    expect(shouldSubmitEndpoint(w1.endpoint, w1.endpoint, w1.putError)).toBe(false);
    const s2 = fleetReducer(s1, { type: 'providerError', role: 'worker', message: 'endpoint precisa ser http(s)' });
    const w2 = selectRoles(s2).find((r) => r.key === 'worker')!;
    expect(w2.error).toBe('endpoint precisa ser http(s)');
    expect(shouldSubmitEndpoint(w2.endpoint, w2.endpoint, w2.putError)).toBe(true);
  });
});

describe('selectNeedsCount', () => {
  it('é o tamanho da lista "Precisam de você" (precisa de atenção e offline), não só needs', () => {
    const tiles = [{ state: 'needs' }, { state: 'offline' }, { state: 'running' }] as never;
    expect(selectNeedsCount(tiles)).toBe(2);
    expect(selectNeedsCount(tiles)).toBe(selectNeedsList(tiles).length);
  });
});

describe('byAttention', () => {
  it('quem precisa de alguém vem primeiro (atenção, depois offline); o resto na ordem de antes', () => {
    const tiles = [{ name: 'a', state: 'running' }, { name: 'b', state: 'offline' }, { name: 'c', state: 'idle' }, { name: 'd', state: 'needs' }, { name: 'e', state: 'running' }];
    expect(byAttention(tiles).map((t) => t.name)).toEqual(['d', 'b', 'a', 'c', 'e']);
  });
});

describe('selectGoalStats — kill switch', () => {
  it('com o kill switch acionado, ninguém conta como rodando', () => {
    const tiles = [{ state: 'running', cost: 0 }, { state: 'running', cost: 0 }] as never;
    expect(selectGoalStats(tiles, 2, true)[0].value).toBe('2/2');
    expect(selectGoalStats(tiles, 2, true, undefined, true)[0].value).toBe('0/2');
  });
});
