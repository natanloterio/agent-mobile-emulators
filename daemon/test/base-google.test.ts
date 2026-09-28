import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { createMission, listMemory } from '../src/db/missions.js';
import { upsertIdentity } from '../src/db/identities.js';
import { baseMissionText, googleAccountEmail, isEmail, saveGoogleAccount, seedGoogleMemory } from '../src/base/google-account.js';
import type { Vault } from '../src/vault/vault.js';

function memVault(): Vault {
  const m = new Map<string, { v: string; meta: string | null }>();
  return {
    put: async (id, v, meta = null) => { m.set(id, { v, meta }); }, get: async (id) => m.get(id)?.v ?? null,
    remove: async (id) => { m.delete(id); }, list: async (p) => [...m].filter(([k]) => k.startsWith(p)).map(([id, e]) => ({ id, meta: e.meta })),
    available: async () => ({ ok: true, reason: null }),
  };
}

describe('conta Google do celular-base', () => {
  it('guarda a senha no cofre e o e-mail como meta; lê só o e-mail', async () => {
    const v = memVault();
    expect(await googleAccountEmail(v)).toBeNull();
    await saveGoogleAccount(v, ' eu@gmail.com ', 's3nha');
    expect(await googleAccountEmail(v)).toBe('eu@gmail.com');
    expect(await v.get('google:password')).toBe('s3nha');
  });
  it('a memória da missão guarda a referência do segredo, nunca a senha', () => {
    const db = openDb(':memory:');
    upsertIdentity(db, { id: 'base', name: 'base', handle: '', avdName: 'g', serial: 'emulator-5554', consolePort: 5554, mcpHostPort: 8080, mcpToken: 't', deviceSlug: 'base', appPackage: 'p', appVersionName: '', state: 'idle' });
    const id = createMission(db, 'base', 'x', 'pt');
    seedGoogleMemory(db, id, 'eu@gmail.com');
    expect(listMemory(db, id).map((m) => [m.key, m.value, m.secret])).toEqual([['google.email', 'eu@gmail.com', false], ['google.password', 'google:password', true]]);
  });
  it('objetivo no idioma da tela, só instalar; não mexe nas contas (a remoção é do Tapflock, sem modelo)', () => {
    expect(baseMissionText('pt', 'com.instagram.android')).toMatch(/Não mexa nas contas/);
    expect(baseMissionText('en', 'com.instagram.android')).toMatch(/Do not touch the phone accounts/);
    expect(isEmail('a@b.co')).toBe(true); expect(isEmail('nada')).toBe(false);
  });
});
