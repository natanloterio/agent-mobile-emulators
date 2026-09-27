import { describe, expect, it, vi } from 'vitest';
import { modelFor } from '../data/providers';
import type { FleetAction } from './fleetReducer';
import { createProviderActions, type ProviderBridge } from './providerActions';

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(bridge: ProviderBridge | undefined) {
  const actions: FleetAction[] = [];
  const created = createProviderActions({
    dispatch: (a) => { actions.push(a); },
    getBridge: () => bridge,
    getMode: () => 'local',
  });
  return { actions, created };
}

const models = (list: readonly string[], error: string | null = null) =>
  vi.fn(() => Promise.resolve({ source: 'ollama', models: list, error }));

describe('createProviderActions', () => {
  it('testConnection: testStart, depois testDone, depois recarrega a lista (Ollama subiu no teste)', async () => {
    const getProviderModels = models(['qwen3.5:27b']);
    const testProvider = vi.fn(() => Promise.resolve({} as never));
    const { actions, created } = setup({ testProvider, getProviderModels });
    created.testConnection('worker');
    expect(actions.map((a) => a.type)).toEqual(['testStart']);
    await flush();
    expect(testProvider).toHaveBeenCalledWith('worker');
    expect(getProviderModels).toHaveBeenCalledWith('worker');
    expect(actions).toEqual([
      { type: 'testStart', role: 'worker' },
      { type: 'testDone', role: 'worker' },
      { type: 'providerModels', role: 'worker', models: ['qwen3.5:27b'] },
      { type: 'providerModelsError', role: 'worker', message: null },
    ]);
  });

  it('testConnection rejeitado ainda despacha testDone e recarrega', async () => {
    const getProviderModels = models([], 'Ollama parado — o próximo teste ou objetivo o sobe');
    const testProvider = vi.fn(() => Promise.reject(new Error('fetch failed')));
    const { actions, created } = setup({ testProvider, getProviderModels });
    created.testConnection('esc');
    await flush();
    expect(actions.map((a) => a.type)).toEqual(['testStart', 'testDone', 'providerModels', 'providerModelsError']);
    expect(getProviderModels).toHaveBeenCalledWith('esc');
  });

  it('setProviderField: sucesso limpa o erro de PUT; falha grava bridgeMessage(e)', async () => {
    const ok = setup({ setProvider: vi.fn(() => Promise.resolve()) });
    ok.created.setProviderField('worker', { endpoint: 'http://127.0.0.1:11434/v1' });
    await flush();
    expect(ok.actions).toEqual([{ type: 'providerError', role: 'worker', message: null }]);

    const err = new Error(`Error invoking remote method 'enxame:setProvider': Error: /providers/worker → 400: {"error":"endpoint precisa ser http(s)"}`);
    const bad = setup({ setProvider: vi.fn(() => Promise.reject(err)) });
    bad.created.setProviderField('worker', { endpoint: 'ftp://x' });
    await flush();
    expect(bad.actions).toEqual([{ type: 'providerError', role: 'worker', message: 'endpoint precisa ser http(s)' }]);
  });

  it('loadProviderModels: falha da bridge grava o erro de carga, não o de PUT', async () => {
    const getProviderModels = vi.fn(() => Promise.reject(new Error('fetch failed')));
    const { actions, created } = setup({ getProviderModels });
    created.loadProviderModels('worker');
    await flush();
    expect(actions).toEqual([{ type: 'providerModelsError', role: 'worker', message: 'fetch failed' }]);
  });

  it('sem daemon: loadProviderModels despacha a lista mock do papel no modo corrente (spec §4.5)', () => {
    const { actions, created } = setup(undefined);
    created.loadProviderModels('worker');
    expect(actions).toEqual([{ type: 'providerModels', role: 'worker', models: [modelFor('worker', 'local')] }]);
  });

  it('sem daemon: testConnection só despacha testStart (o timer do mock conclui)', () => {
    const { actions, created } = setup(undefined);
    created.testConnection('lider');
    expect(actions).toEqual([{ type: 'testStart', role: 'lider' }]);
  });

  it('pickMode com daemon: sucesso troca o modo e limpa o erro de PUT, sem GET extra', async () => {
    const getProviderModels = models([]);
    const { actions, created } = setup({ setProvider: vi.fn(() => Promise.resolve()), getProviderModels });
    created.pickMode('worker', 'nuvem');
    await flush();
    expect(actions).toEqual([
      { type: 'pickMode', role: 'worker', mode: 'nuvem' },
      { type: 'providerError', role: 'worker', message: null },
    ]);
    expect(getProviderModels).not.toHaveBeenCalled();
  });

  it('loadProviderModels repassa entries e runtimes do daemon novo', async () => {
    const runtimes = [{ kind: 'ollama', label: 'Ollama', endpoint: 'http://127.0.0.1:11434/v1', installed: true, running: true, error: null }] as const;
    const entries = [{ id: 'qwen3:8b', runtime: 'ollama', label: 'qwen3:8b', sizeBytes: 5.2e9, loaded: true, toolUse: true }] as const;
    const getProviderModels = vi.fn(() => Promise.resolve({ source: 'local', models: ['qwen3:8b'], error: null, runtimes, entries }));
    const { actions, created } = setup({ getProviderModels });
    created.loadProviderModels('worker');
    await flush();
    expect(actions[0]).toStrictEqual({ type: 'providerModels', role: 'worker', models: ['qwen3:8b'], entries, runtimes });
  });

  it('daemon antigo: providerModels sai sem entries/runtimes', async () => {
    const { actions, created } = setup({ getProviderModels: models(['qwen3:8b']) });
    created.loadProviderModels('worker');
    await flush();
    expect(actions[0]).toStrictEqual({ type: 'providerModels', role: 'worker', models: ['qwen3:8b'] });
  });

  it('setProviderField com runtime: PUT { runtime, model } e recarrega a lista depois', async () => {
    const setProvider = vi.fn(() => Promise.resolve());
    const getProviderModels = models(['qwen/qwen3-8b']);
    const { actions, created } = setup({ setProvider, getProviderModels });
    created.setProviderField('worker', { runtime: 'lmstudio', model: 'qwen/qwen3-8b' });
    await flush();
    expect(setProvider).toHaveBeenCalledWith('worker', { runtime: 'lmstudio', model: 'qwen/qwen3-8b' });
    expect(getProviderModels).toHaveBeenCalledWith('worker');
    expect(actions.map((a) => a.type)).toEqual(['providerError', 'providerModels', 'providerModelsError']);
  });

  it('setProviderField sem runtime não relê a lista; com runtime recusado também não', async () => {
    const getProviderModels = models([]);
    const ok = setup({ setProvider: vi.fn(() => Promise.resolve()), getProviderModels });
    ok.created.setProviderField('worker', { model: 'qwen3:8b' });
    await flush();
    const bad = setup({ setProvider: vi.fn(() => Promise.reject(new Error('busy'))), getProviderModels });
    bad.created.setProviderField('worker', { runtime: 'lmstudio', model: 'x' });
    await flush();
    expect(getProviderModels).not.toHaveBeenCalled();
    expect(bad.actions).toEqual([{ type: 'providerError', role: 'worker', message: 'busy' }]);
  });
});
