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

describe('identities — revisão final (I9)', () => {
  it('lastError: null limpa; omitir mantém', () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    setIdentityState(db, 'conta1', 'needs-human', { lastError: 'checkpoint' });
    setIdentityState(db, 'conta1', 'idle');
    expect(getIdentity(db, 'conta1')?.lastError).toBe('checkpoint');
    setIdentityState(db, 'conta1', 'idle', { lastError: null });
    expect(getIdentity(db, 'conta1')?.lastError).toBeNull();
  });
});

describe('step — revisão final (I10)', () => {
  it('idempotency_key é único por tarefa', async () => {
    const { createGoalAndTask, writeIntent } = await import('../src/db/tasks.js');
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const { taskId } = createGoalAndTask(db, 'conta1', 'g');
    writeIntent(db, taskId, 1, 't', {}, 'k1');
    expect(() => writeIntent(db, taskId, 2, 't', {}, 'k1')).toThrow(/UNIQUE|unique/i);
  });
});
