import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { LOCAL_ENDPOINT_DEFAULT, ollamaBase, PROVIDER_DEFAULTS, providerLabel, readProviderConfig, updateProvider } from '../src/provider/config.js';

describe('provider_config', () => {
  it('semeia defaults na primeira leitura e devolve cópia', () => {
    const db = openDb(':memory:');
    const a = readProviderConfig(db);
    expect(a).toEqual(PROVIDER_DEFAULTS);
    expect(a.worker).toMatchObject({ mode: 'nuvem', model: 'claude-haiku-4-5' });
    expect(a).not.toBe(PROVIDER_DEFAULTS);
    expect((db.prepare('select count(*) as n from provider_config').get() as { n: number }).n).toBe(3);
  });
  it('updateProvider aplica patch, endpoint default do local, e valida', () => {
    const db = openDb(':memory:');
    const w = updateProvider(db, 'worker', { mode: 'local', model: 'qwen3.5:27b' });
    expect(w).toEqual({ role: 'worker', mode: 'local', model: 'qwen3.5:27b', endpoint: LOCAL_ENDPOINT_DEFAULT });
    expect(readProviderConfig(db).worker.model).toBe('qwen3.5:27b');
    expect(updateProvider(db, 'worker', { mode: 'nuvem' }).endpoint).toBe('anthropic');
    expect(() => updateProvider(db, 'worker', { mode: 'x' } as never)).toThrow();
    expect(() => updateProvider(db, 'worker', { endpoint: 'não é url' })).toThrow();
    expect(() => updateProvider(db, 'worker', { foo: 1 } as never)).toThrow();
  });
  it('ollamaBase normaliza /v1, /v1/ e barra final (Review Focus 2)', () => {
    for (const e of ['http://127.0.0.1:11434/v1', 'http://127.0.0.1:11434/v1/', 'http://127.0.0.1:11434/', 'http://127.0.0.1:11434'])
      expect(ollamaBase(e)).toBe('http://127.0.0.1:11434');
  });
  it('providerLabel e migração idempotente (colunas novas existem; abrir duas vezes não quebra)', () => {
    const db = openDb(':memory:');
    expect(providerLabel({ role: 'worker', mode: 'local', model: 'm', endpoint: 'e' })).toBe('local:m');
    const cols = (t: string) => (db.prepare(`pragma table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    expect(cols('step')).toEqual(expect.arrayContaining(['provider', 'gen_ms', 'invalid_call']));
    expect(cols('task')).toEqual(expect.arrayContaining(['degraded', 'escalated_at_step']));
  });
});
