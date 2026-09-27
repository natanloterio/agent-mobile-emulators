import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { applyMigrations } from '../src/db/migrate.js';
import { openDb } from '../src/db/open.js';
import { SCHEMA } from '../src/db/schema.js';
import { CLOUD_MODELS, LOCAL_ENDPOINT_DEFAULT, ollamaBase, patchErrorMessage, PROVIDER_DEFAULTS, ProviderPatch, providerLabel, readProviderConfig, seedProviderConfig, updateProvider } from '../src/provider/config.js';

describe('provider_config', () => {
  it('semeia defaults na primeira leitura e devolve cópia', () => {
    const db = openDb(':memory:');
    const a = readProviderConfig(db);
    expect(a).toEqual(PROVIDER_DEFAULTS);
    expect(a.worker).toMatchObject({ mode: 'local', model: 'gpt-oss:20b', endpoint: LOCAL_ENDPOINT_DEFAULT });
    expect(a).not.toBe(PROVIDER_DEFAULTS);
    expect((db.prepare('select count(*) as n from provider_config').get() as { n: number }).n).toBe(3);
  });
  it('updateProvider aplica patch, endpoint default do local, e valida', () => {
    const db = openDb(':memory:');
    const w = updateProvider(db, 'worker', { mode: 'local', model: 'qwen3.5:27b' });
    expect(w).toEqual({ role: 'worker', mode: 'local', model: 'qwen3.5:27b', endpoint: LOCAL_ENDPOINT_DEFAULT, runtime: 'ollama' });
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

  it('trocar o modo sem informar modelo aplica o modelo default do (papel, modo) (revisão final, Important 4)', () => {
    const db = openDb(':memory:');
    expect(updateProvider(db, 'worker', { mode: 'nuvem' })).toMatchObject({ mode: 'nuvem', model: 'claude-haiku-4-5', endpoint: 'anthropic' });
    expect(updateProvider(db, 'esc', { mode: 'local' })).toMatchObject({ mode: 'local', model: 'gpt-oss:20b', endpoint: LOCAL_ENDPOINT_DEFAULT });
    expect(updateProvider(db, 'lider', { mode: 'nuvem', model: 'claude-opus-5' }).model).toBe('claude-opus-5');
  });
});

describe('config — incremento 3', () => {
  it('endpoint só http(s); mensagem única legível', () => {
    for (const e of ['ftp://x/v1', 'file:///etc/passwd', 'javascript:alert(1)']) {
      const r = ProviderPatch.safeParse({ endpoint: e }); expect(r.success, e).toBe(false);
      if (!r.success) expect(patchErrorMessage(r.error)).toBe('endpoint precisa ser http(s)');
    }
    expect(ProviderPatch.safeParse({ endpoint: 'http://192.168.1.5:11434/v1' }).success).toBe(true);
    expect(CLOUD_MODELS).toEqual(['claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5']);
  });
  it('readProviderConfig não insere; seedProviderConfig insere uma vez; openDb semeia', () => {
    const raw = new DatabaseSync(':memory:'); raw.exec(SCHEMA); applyMigrations(raw);
    expect(readProviderConfig(raw).worker.model).toBe('gpt-oss:20b');
    expect((raw.prepare('select count(*) as n from provider_config').get() as { n: number }).n).toBe(0);
    seedProviderConfig(raw); seedProviderConfig(raw);
    expect((raw.prepare('select count(*) as n from provider_config').get() as { n: number }).n).toBe(3);
    const db = openDb(':memory:');
    expect((db.prepare('select count(*) as n from provider_config').get() as { n: number }).n).toBe(3);
  });
});
