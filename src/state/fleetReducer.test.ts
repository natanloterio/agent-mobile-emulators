import { describe, expect, it } from 'vitest';
import type { ModelEntry, RuntimeInfo } from '../live/types';
import { createInitialState, fleetReducer } from './fleetReducer';

const RUNTIMES: readonly RuntimeInfo[] = [
  { kind: 'ollama', label: 'Ollama', endpoint: 'http://127.0.0.1:11434/v1', installed: true, running: false, error: null },
  { kind: 'lmstudio', label: 'LM Studio', endpoint: 'http://127.0.0.1:1234/v1', installed: true, running: true, error: null },
];
const ENTRIES: readonly ModelEntry[] = [
  { id: 'qwen3:8b', runtime: 'ollama', label: 'qwen3:8b', sizeBytes: 5.2e9, loaded: null, toolUse: true },
  { id: 'qwen/qwen3-8b', runtime: 'lmstudio', label: 'Qwen3 8B', sizeBytes: 4.9e9, loaded: true, toolUse: true },
];

describe('fleetReducer — provedores (incremento 3)', () => {
  it('providerError grava e limpa por papel (Review Focus 4)', () => {
    const s0 = createInitialState();
    const s1 = fleetReducer(s0, { type: 'providerError', role: 'worker', message: 'objetivo ou teste em execução' });
    expect(s1.providerErrors.worker).toBe('objetivo ou teste em execução'); expect(s1.providerErrors.esc).toBeUndefined();
    const s2 = fleetReducer(s1, { type: 'providerError', role: 'worker', message: null });
    expect(s2.providerErrors.worker).toBeUndefined(); expect(s0.providerErrors).toEqual({});
  });
  it('providerModels grava a lista por papel sem mutar o estado anterior', () => {
    const s0 = createInitialState();
    const s1 = fleetReducer(s0, { type: 'providerModels', role: 'worker', models: ['gpt-oss:20b', 'gemma4:12b'] });
    expect(s1.providerModels.worker).toEqual(['gpt-oss:20b', 'gemma4:12b']); expect(s0.providerModels).toEqual({});
  });
  it('providerModelsError vive num slot separado: PUT bem-sucedido não apaga "Ollama parado"', () => {
    const s0 = createInitialState();
    const s1 = fleetReducer(s0, { type: 'providerModelsError', role: 'worker', message: 'Ollama parado — o próximo teste ou objetivo o sobe' });
    const s2 = fleetReducer(s1, { type: 'providerError', role: 'worker', message: null });
    expect(s2.providerModelsErrors.worker).toBe('Ollama parado — o próximo teste ou objetivo o sobe');
    expect(s2.providerErrors.worker).toBeUndefined(); expect(s0.providerModelsErrors).toEqual({});
    const s3 = fleetReducer(s2, { type: 'providerModelsError', role: 'worker', message: null });
    expect(s3.providerModelsErrors.worker).toBeUndefined(); expect(s2.providerModelsErrors.worker).toBeDefined();
  });
  it('providerModels com entries/runtimes guarda o catálogo local do papel; sem eles (daemon antigo) o apaga', () => {
    const s0 = createInitialState();
    const s1 = fleetReducer(s0, { type: 'providerModels', role: 'worker', models: ['qwen3:8b'], entries: ENTRIES, runtimes: RUNTIMES });
    expect(s1.providerCatalogs.worker).toEqual({ entries: ENTRIES, runtimes: RUNTIMES });
    expect(s1.providerModels.worker).toEqual(['qwen3:8b']); expect(s0.providerCatalogs).toEqual({});
    const s2 = fleetReducer(s1, { type: 'providerModels', role: 'worker', models: ['claude-sonnet-4-6'] });
    expect(s2.providerCatalogs).toEqual({}); expect(s1.providerCatalogs.worker).toBeDefined();
  });
  it('catálogo parcial (só runtimes) vira lista de entries vazia', () => {
    const s1 = fleetReducer(createInitialState(), { type: 'providerModels', role: 'esc', models: [], runtimes: RUNTIMES });
    expect(s1.providerCatalogs.esc).toEqual({ entries: [], runtimes: RUNTIMES });
  });
});
