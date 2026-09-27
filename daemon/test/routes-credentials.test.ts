import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { upsertIdentity } from '../src/db/identities.js';
import { startServer } from '../src/server/api.js';
import { credentialRoutes } from '../src/server/routes-credentials.js';
import { getCredential } from '../src/vault/credentials.js';
import { createVault, VaultError } from '../src/vault/vault.js';
import { memVault } from './fixtures/mem-vault.js';

let stop: (() => Promise<void>) | null = null;
afterEach(async () => { await stop?.(); stop = null; });
const h = { authorization: 'Bearer seg', 'content-type': 'application/json' };
const row = { id: 'conta2', name: 'conta2', handle: 'sem conta', avdName: 'x', serial: 's', consolePort: 5556, mcpHostPort: 8081, mcpToken: 't', deviceSlug: 'conta2', appPackage: 'com.instagram.android', appVersionName: '1', state: 'idle' as const };

async function mk(vault = memVault()) {
  const db = openDb(':memory:'); upsertIdentity(db, row);
  const s = await startServer({ db, port: 0, token: 'seg', onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); }, onGoal: async () => ({ goalId: 'g', done: Promise.resolve() }), routes: [credentialRoutes({ vault })] });
  stop = s.close;
  const call = (method: string, path: string, body?: unknown) => fetch(`http://127.0.0.1:${s.port}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  return { vault, call };
}

describe('rotas de credenciais', () => {
  it('PUT grava no cofre; GET lista só usuários; DELETE apaga', async () => {
    const { vault, call } = await mk();
    expect((await call('PUT', '/identities/conta2/credentials', { username: 'nova', password: 'SenhaMuitoSecreta1' })).status).toBe(204);
    expect(await getCredential(vault, 'conta2')).toEqual({ username: 'nova', password: 'SenhaMuitoSecreta1' });
    const r = await call('GET', '/credentials');
    const body = await r.text();
    expect(body).not.toContain('SenhaMuitoSecreta1');
    expect(JSON.parse(body)).toEqual({ available: { ok: true, reason: null }, entries: { conta2: { username: 'nova' } } });
    expect((await call('DELETE', '/identities/conta2/credentials')).status).toBe(204);
    expect(await getCredential(vault, 'conta2')).toBeNull();
  });
  it('400 sem repetir a senha; 404 identidade desconhecida', async () => {
    const { call } = await mk();
    const r = await call('PUT', '/identities/conta2/credentials', { username: '', password: 'x'.repeat(201) });
    expect(r.status).toBe(400); expect(await r.text()).not.toContain('x'.repeat(50));
    expect((await call('PUT', '/identities/nada/credentials', { username: 'a', password: 'b' })).status).toBe(404);
  });
  it('cofre indisponível → 503 com o motivo; GET mostra available.ok=false', async () => {
    const broken = createVault({ file: '/nao/existe.json', keys: { load: async () => { throw new VaultError('secret-tool ausente: instale libsecret-tools'); }, store: async () => undefined } });
    const { call } = await mk(broken);
    const r = await call('PUT', '/identities/conta2/credentials', { username: 'a', password: 'b' });
    expect(r.status).toBe(503); expect(await r.json()).toEqual({ error: 'secret-tool ausente: instale libsecret-tools' });
    expect(((await (await call('GET', '/credentials')).json()) as { available: { ok: boolean } }).available.ok).toBe(false);
  });
  it('import grava as válidas e ignora ids desconhecidos', async () => {
    const { vault, call } = await mk();
    const r = await call('POST', '/credentials/import', { entries: [{ id: 'conta2', username: 'u', password: 'p-antiga-123' }, { id: 'sumiu', username: 'x', password: 'y' }] });
    expect(await r.json()).toEqual({ imported: 1 });
    expect(await getCredential(vault, 'conta2')).toEqual({ username: 'u', password: 'p-antiga-123' });
  });
});
