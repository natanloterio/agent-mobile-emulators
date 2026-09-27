import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { getIdentity, upsertIdentity } from '../src/db/identities.js';
import { createMission, memoryPut } from '../src/db/missions.js';
import { promoteAccounts } from '../src/mission/promote.js';
import { credentialStatus, getCredential, putCredential } from '../src/vault/credentials.js';
import { memVault } from './fixtures/mem-vault.js';

const row = { id: 'conta2', name: 'conta2', handle: 'sem conta', avdName: 'x', serial: 's', consolePort: 5556, mcpHostPort: 8081, mcpToken: 't', deviceSlug: 'conta2', appPackage: 'com.instagram.android', appVersionName: '1', state: 'idle' as const };

async function setup(o: { handle?: string; withPassword?: boolean; snapshotFails?: boolean } = {}) {
  const db = openDb(':memory:'); upsertIdentity(db, { ...row, handle: o.handle ?? 'sem conta' });
  const vault = memVault(); const m = createMission(db, 'conta2', 'x', 'pt');
  memoryPut(db, m, 'account.com.instagram.android.username', 'nova.conta_2026');
  if (o.withPassword !== false) { await vault.put(`mission:${m}:account.com.instagram.android.password`, 'Senha#Forte12345678'); memoryPut(db, m, 'account.com.instagram.android.password', `mission:${m}:account.com.instagram.android.password`, true); }
  const snaps: string[] = [];
  const deps = { db, vault, now: () => '2026-09-27T12:00:00Z', snapshot: async (i: { id: string }) => { if (o.snapshotFails) throw new Error('emu recusou'); snaps.push(i.id); } };
  return { db, vault, m, snaps, deps };
}

describe('credenciais no cofre', () => {
  it('put/get/status por identidade; status nunca traz a senha', async () => {
    const v = memVault();
    await putCredential(v, 'conta1', { username: 'u1', password: 'p1-secreta' });
    expect(await getCredential(v, 'conta1')).toEqual({ username: 'u1', password: 'p1-secreta' });
    expect(await credentialStatus(v)).toEqual({ conta1: { username: 'u1' } });
  });
});

describe('promoteAccounts', () => {
  it('username + senha do app alvo → credencial, handle, logged-in e snapshot', async () => {
    const s = await setup();
    expect(await promoteAccounts(s.m, s.deps)).toBe(true);
    expect(await getCredential(s.vault, 'conta2')).toEqual({ username: 'nova.conta_2026', password: 'Senha#Forte12345678' });
    expect(getIdentity(s.db, 'conta2')).toMatchObject({ handle: '@nova.conta_2026', state: 'logged-in', snapshotTakenAt: '2026-09-27T12:00:00Z' });
    expect(s.snaps).toEqual(['conta2']);
  });
  it('identidade que já tinha conta: só a credencial muda', async () => {
    const s = await setup({ handle: '@antiga' });
    await promoteAccounts(s.m, s.deps);
    expect(getIdentity(s.db, 'conta2')).toMatchObject({ handle: '@antiga', state: 'idle' });
    expect(s.snaps).toEqual([]);
  });
  it('sem senha na memória → não promove nada', async () => {
    const s = await setup({ withPassword: false });
    expect(await promoteAccounts(s.m, s.deps)).toBe(false);
    expect(await getCredential(s.vault, 'conta2')).toBeNull();
  });
  it('snapshot falha → logged-in com o erro anotado', async () => {
    const s = await setup({ snapshotFails: true });
    await promoteAccounts(s.m, s.deps);
    expect(getIdentity(s.db, 'conta2')).toMatchObject({ state: 'logged-in' });
    expect(getIdentity(s.db, 'conta2')?.lastError).toMatch(/snapshot após missão falhou/);
  });
});
