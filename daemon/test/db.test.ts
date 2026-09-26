import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { getIdentity, setIdentityState, upsertIdentity } from '../src/db/identities.js';

const row = {
  id: 'conta1', name: 'conta1', handle: '@aurora.moda', avdName: 'mcp_test_playstore', serial: 'emulator-5554',
  consolePort: 5554, mcpHostPort: 8080, mcpToken: 'tok', deviceSlug: 'conta1',
  appPackage: 'com.instagram.android', appVersionName: '448.0.0.52.84', state: 'logged-in' as const,
};

describe('identities', () => {
  it('cria o schema e faz upsert idempotente', () => {
    const db = openDb(':memory:');
    upsertIdentity(db, row);
    upsertIdentity(db, { ...row, handle: '@nova' });
    expect(getIdentity(db, 'conta1')?.handle).toBe('@nova');
    expect(db.prepare('select count(*) as n from identity').get()).toEqual({ n: 1 });
  });
  it('setIdentityState grava estado e patch sem mutar o objeto de entrada', () => {
    const db = openDb(':memory:');
    upsertIdentity(db, row);
    setIdentityState(db, 'conta1', 'needs-human', { bannedReason: null, lastError: 'checkpoint' });
    const got = getIdentity(db, 'conta1');
    expect(got?.state).toBe('needs-human');
    expect(got?.lastError).toBe('checkpoint');
    expect(row.state).toBe('logged-in');
  });
});
