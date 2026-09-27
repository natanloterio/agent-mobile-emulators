import { describe, expect, it } from 'vitest';
import { createSettingsActions } from './settingsActions';

function mk() {
  const calls: { method: string; path: string; body?: unknown }[] = []; const actions: unknown[] = [];
  const bridge = { api: async (method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) => { calls.push({ method, path, body }); return { goal: 45, mission: null }; } };
  const a = createSettingsActions({ dispatch: (x) => actions.push(x), getBridge: () => bridge });
  return { a, calls, actions };
}

describe('settingsActions', () => {
  it('saveBudgets manda PUT /settings/budgets com o patch; devolve true no sucesso', async () => {
    const t = mk();
    expect(await t.a.saveBudgets({ goal: 45, mission: null })).toBe(true);
    expect(t.calls).toEqual([{ method: 'PUT', path: '/settings/budgets', body: { goal: 45, mission: null } }]);
    expect(t.actions).toContainEqual({ type: 'request', key: 'budgets', phase: 'ok' });
  });
  it('sem bridge: erro "daemon não conectado" e devolve false', async () => {
    const actions: unknown[] = [];
    const a = createSettingsActions({ dispatch: (x) => actions.push(x), getBridge: () => undefined });
    expect(await a.saveBudgets({ goal: 10 })).toBe(false);
    expect(actions).toContainEqual({ type: 'requestError', key: 'budgets', message: expect.stringMatching(/./) });
  });
  it('erro do daemon (400/409) vira requestError com a chave budgets', async () => {
    const actions: unknown[] = [];
    const bridge = { api: async () => { throw new Error('/settings/budgets → 400: {"error":"goal: obrigatório 1..1000"}'); } };
    const a = createSettingsActions({ dispatch: (x) => actions.push(x), getBridge: () => bridge });
    expect(await a.saveBudgets({ goal: 0 })).toBe(false);
    expect(actions).toContainEqual({ type: 'requestError', key: 'budgets', message: expect.stringContaining('obrigatório') });
  });
  it('saveLocalParallel manda PUT /settings/local com { parallel }; devolve true no sucesso', async () => {
    const t = mk();
    expect(await t.a.saveLocalParallel(4)).toBe(true);
    expect(t.calls).toEqual([{ method: 'PUT', path: '/settings/local', body: { parallel: 4 } }]);
    expect(t.actions).toContainEqual({ type: 'request', key: 'localParallel', phase: 'ok' });
  });
  it('saveLocalParallel sem bridge: erro "daemon não conectado" e devolve false', async () => {
    const actions: unknown[] = [];
    const a = createSettingsActions({ dispatch: (x) => actions.push(x), getBridge: () => undefined });
    expect(await a.saveLocalParallel(4)).toBe(false);
    expect(actions).toContainEqual({ type: 'requestError', key: 'localParallel', message: expect.stringMatching(/./) });
  });
});
