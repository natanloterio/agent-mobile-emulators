import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { LOCAL_ENDPOINTS, readProviderConfig, runtimeForEndpoint, updateProvider } from '../src/provider/config.js';

describe('runtime local por papel', () => {
  it('local sem runtime gravado é ollama; nuvem é null', () => {
    const db = openDb(':memory:');
    const cfg = readProviderConfig(db);
    expect(cfg.worker).toMatchObject({ mode: 'local', runtime: 'ollama' });
    expect(cfg.lider.runtime).toBeNull();
  });
  it('trocar o runtime sem endpoint volta ao endpoint default dele; com endpoint, respeita', () => {
    const db = openDb(':memory:');
    expect(updateProvider(db, 'worker', { runtime: 'lmstudio', model: 'google/gemma-4-12b-qat' })).toMatchObject({ runtime: 'lmstudio', endpoint: LOCAL_ENDPOINTS.lmstudio, model: 'google/gemma-4-12b-qat' });
    expect(readProviderConfig(db).worker.runtime).toBe('lmstudio');
    expect(updateProvider(db, 'worker', { runtime: 'ollama', endpoint: 'http://127.0.0.1:11500/v1' }).endpoint).toBe('http://127.0.0.1:11500/v1');
  });
  it('papel na nuvem passando para local assume ollama; runtime inválido é recusado', () => {
    const db = openDb(':memory:');
    expect(updateProvider(db, 'lider', { mode: 'local' })).toMatchObject({ runtime: 'ollama', endpoint: LOCAL_ENDPOINTS.ollama });
    expect(updateProvider(db, 'lider', { mode: 'nuvem' }).runtime).toBeNull();
    expect(() => updateProvider(db, 'worker', { runtime: 'vllm' as never })).toThrow();
  });
  it('runtimeForEndpoint: porta 1234 é LM Studio, o resto Ollama', () => {
    expect(runtimeForEndpoint('http://127.0.0.1:1234/v1')).toBe('lmstudio');
    expect(runtimeForEndpoint('http://localhost:11434/v1')).toBe('ollama');
  });
});
