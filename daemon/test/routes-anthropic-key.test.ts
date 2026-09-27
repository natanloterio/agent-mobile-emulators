import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { createApiKeyStore } from '../src/provider/api-key.js';
import { startServer } from '../src/server/api.js';
import { anthropicKeyRoutes } from '../src/server/routes-anthropic-key.js';
import { VaultError } from '../src/vault/vault.js';

let stop: (() => Promise<void>) | null = null;
afterEach(async () => { await stop?.(); stop = null; });
const h = { authorization: 'Bearer seg', 'content-type': 'application/json' };
const KEY = 'sk-ant-' + 'x'.repeat(30);

async function mk(vault: { get: (id: string) => Promise<string | null>; put: (id: string, v: string) => Promise<void> }) {
  const store = createApiKeyStore({ envKey: '', vault });
  const s = await startServer({
    db: openDb(':memory:'), port: 0, token: 'seg', onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); },
    onGoal: async () => ({ goalId: 'g', done: Promise.resolve() }), routes: [anthropicKeyRoutes({ store })],
  });
  stop = s.close;
  const call = (method: string, body?: unknown) => fetch(`http://127.0.0.1:${s.port}/settings/anthropic-key`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  return { call, store };
}

describe('rota da chave da Anthropic', () => {
  it('GET diz se há chave e de onde, nunca o valor', async () => {
    const { call } = await mk({ get: async () => null, put: async () => {} });
    expect(await (await call('GET')).json()).toEqual({ configured: false, source: null });
  });
  it('PUT válido grava e GET passa a dizer vault', async () => {
    const { call, store } = await mk({ get: async () => null, put: async () => {} });
    expect((await call('PUT', { key: KEY })).status).toBe(204);
    expect(store.current()).toBe(KEY);
    const body = await (await call('GET')).json();
    expect(body).toEqual({ configured: true, source: 'vault' });
    expect(JSON.stringify(body)).not.toContain(KEY);
  });
  it('400 para chave curta, sem sk-ant- ou campo a mais; a resposta não repete a chave', async () => {
    const { call } = await mk({ get: async () => null, put: async () => {} });
    const r = await call('PUT', { key: 'abc' });
    expect(r.status).toBe(400);
    expect(await r.text()).not.toContain('abc"');
    expect((await call('PUT', { key: 'sk-xyz-' + 'x'.repeat(30) })).status).toBe(400);
    expect((await call('PUT', { key: KEY, extra: 1 })).status).toBe(400);
  });
  it('503 quando o chaveiro do sistema recusa', async () => {
    const { call } = await mk({ get: async () => null, put: async () => { throw new VaultError('chaveiro do sistema indisponível: locked'); } });
    const r = await call('PUT', { key: KEY });
    expect(r.status).toBe(503);
    expect((await r.json()).error).toMatch(/chaveiro/);
  });
});
