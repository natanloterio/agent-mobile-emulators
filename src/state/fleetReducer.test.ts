import { describe, expect, it } from 'vitest';
import { createInitialState, fleetReducer } from './fleetReducer';

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
});
