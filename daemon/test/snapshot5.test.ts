import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { getIdentity, setIdentityFlags, upsertIdentity } from '../src/db/identities.js';
import { createGoalAndTask, ledgerPut, setTaskState } from '../src/db/tasks.js';
import { startServer } from '../src/server/api.js';
import { buildSnapshot, isRestoreUnsafe, listGoals, sqliteUtcMs } from '../src/server/snapshot.js';

const row = { id: 'conta1', name: 'conta1', handle: '@a', avdName: 'avd1', serial: 'emulator-5554', consolePort: 5554, mcpHostPort: 8080, mcpToken: 't', deviceSlug: 'conta1', appPackage: 'com.instagram.android', appVersionName: '448.0.0.52.84', state: 'idle' as const };

let stop: (() => Promise<void>) | null = null;
afterEach(async () => { await stop?.(); stop = null; });

describe('setIdentityFlags', () => {
  it('grava só os campos presentes e null limpa', () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    setIdentityFlags(db, 'conta1', { paused: true, diskBytes: 123, lastSignals: { bootCompleted: true, accessibility: true, mcpInitialize: true, toolsPresent: true, versionMatch: false } });
    let got = getIdentity(db, 'conta1')!;
    expect(got).toMatchObject({ paused: true, controlled: false, diskBytes: 123 });
    expect(got.lastSignals?.versionMatch).toBe(false);
    setIdentityFlags(db, 'conta1', { controlled: true, lastSignals: null });
    got = getIdentity(db, 'conta1')!;
    expect(got).toMatchObject({ paused: true, controlled: true, lastSignals: null });
    expect(got.createdAt).toBeTruthy();
  });
});

describe('snapshot do incremento 5', () => {
  it('traz ciclo, ledger, portas, sinais e resumo do objetivo', () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const { goalId, taskId } = createGoalAndTask(db, 'conta1', 'objetivo');
    ledgerPut(db, 'conta1', 'comment:a:1', 'comment', 'n', taskId);
    ledgerPut(db, 'conta1', 'comment:b:2', 'comment', 'n', taskId);
    setTaskState(db, taskId, 'done');
    const s = buildSnapshot(db, false, { host: () => ({ ramUsedGiB: 1, ramTotalGiB: 2, cpuPct: 3, threads: 4, vramUsedMiB: null, vramTotalMiB: null, at: 'x' }) });
    expect(s.identities[0]).toMatchObject({ lifecycle: 'idle', paused: false, ledgerCount: 2, consolePort: 5554, mcpHostPort: 8080, avdName: 'avd1', signals: null, restoreUnsafe: false });
    expect(s.goal).toMatchObject({ id: goalId, tasksTotal: 1, tasksDone: 1, itemsHandled: 2 });
    expect(s.host?.threads).toBe(4);
  });
  it('host que lança vira null; sem objetivo, goal null', () => {
    const db = openDb(':memory:');
    const s = buildSnapshot(db, false, { host: () => { throw new Error('x'); } });
    expect(s.host).toBeNull(); expect(s.goal).toBeNull();
  });
  it('restoreUnsafe: snapshot mais velho que o limite', () => {
    const now = sqliteUtcMs('2026-09-26 12:00:00');
    expect(isRestoreUnsafe('2026-09-01 12:00:00', now)).toBe(true);
    expect(isRestoreUnsafe('2026-09-25T12:00:00Z', now)).toBe(false);
    expect(isRestoreUnsafe(null, now)).toBe(false);
  });
  it('listGoals: mais novo primeiro', () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    createGoalAndTask(db, 'conta1', 'um'); createGoalAndTask(db, 'conta1', 'dois');
    expect(listGoals(db).map((g) => g.text)).toEqual(['dois', 'um']);
  });
});

describe('rotas plugáveis', () => {
  it('rota extra trata antes do 404; GET /goals lista', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row); createGoalAndTask(db, 'conta1', 'um');
    const s = await startServer({
      db, port: 0, token: 'seg', onGoal: async () => {}, onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); },
      routes: [async (c) => { if (c.method !== 'POST' || c.url.pathname !== '/eco') return false; c.send(200, { got: await c.body() }); return true; }],
    }); stop = s.close;
    const h = { authorization: 'Bearer seg', 'content-type': 'application/json' };
    const eco = await fetch(`http://127.0.0.1:${s.port}/eco`, { method: 'POST', headers: h, body: JSON.stringify({ a: 1 }) });
    expect(await eco.json()).toEqual({ got: { a: 1 } });
    expect((await fetch(`http://127.0.0.1:${s.port}/nada`, { headers: h })).status).toBe(404);
    const goals = await (await fetch(`http://127.0.0.1:${s.port}/goals`, { headers: h })).json() as { goals: { text: string }[] };
    expect(goals.goals[0].text).toBe('um');
  });
});
