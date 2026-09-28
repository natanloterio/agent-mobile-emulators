import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config.js';
import { openDb } from '../src/db/open.js';
import { getIdentity, setIdentityFlags, upsertIdentity } from '../src/db/identities.js';
import { createMission } from '../src/db/missions.js';
import { writeStepBudgets } from '../src/db/settings.js';
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
  it('marca a identidade que está ligando (fonte do boot em segundo plano)', () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    expect(buildSnapshot(db, false, { booting: () => new Set(['conta1']) }).identities[0].booting).toBe(true);
    expect(buildSnapshot(db, false).identities[0].booting).toBe(false);
  });
  it('diz se o emulador está no adb agora (fonte online); sem fonte, o campo não vem', () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    expect(buildSnapshot(db, false, { online: () => new Set(['emulator-5554']) }).identities[0].online).toBe(true);
    expect(buildSnapshot(db, false, { online: () => new Set() }).identities[0].online).toBe(false);
    expect(buildSnapshot(db, false).identities[0].online).toBeUndefined();
  });
  it('traz o estado do AVD-base quando a fonte existe; sem fonte, null', () => {
    const db = openDb(':memory:');
    expect(buildSnapshot(db, false, { baseAvd: () => ({ name: 'tapflock_golden', found: false, running: false }) }).baseAvd).toEqual({ name: 'tapflock_golden', found: false, running: false });
    expect(buildSnapshot(db, false).baseAvd).toBeNull();
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
  it('budget: identidade com missão aberta usa o orçamento da subtarefa; sem missão, o do worker', () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    expect(buildSnapshot(db, false).identities[0].budget).toBe(CONFIG.worker.stepBudget);
    createMission(db, 'conta1', 'objetivo da missão', 'pt');
    expect(buildSnapshot(db, false).identities[0].budget).toBe(CONFIG.mission.subtaskStepBudget);
  });
  it('budget vem do banco (spec limites §UI), não mais direto do CONFIG; topo do snapshot também traz stepBudgets', () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    writeStepBudgets(db, { goal: 12 });
    const s1 = buildSnapshot(db, false);
    expect(s1.stepBudgets).toEqual({ goal: 12, mission: CONFIG.mission.subtaskStepBudget });
    expect(s1.identities[0].budget).toBe(12);
    createMission(db, 'conta1', 'objetivo da missão', 'pt');
    const s2 = buildSnapshot(db, false);
    expect(s2.identities[0].budget).toBe(CONFIG.mission.subtaskStepBudget);
  });
  it('localParallel: sem fonte, default (wanted 1, nada aplicado, não pendente); com fonte, reflete o valor', () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    expect(buildSnapshot(db, false).localParallel).toEqual({ wanted: 1, applied: { ollama: null, lmstudio: null }, pending: false });
    const s = buildSnapshot(db, false, { localParallel: () => ({ wanted: 4, applied: { ollama: 4, lmstudio: null }, pending: true }) });
    expect(s.localParallel).toEqual({ wanted: 4, applied: { ollama: 4, lmstudio: null }, pending: true });
  });
  it('localParallel: fonte que lança não quebra o snapshot, cai no default', () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const s = buildSnapshot(db, false, { localParallel: () => { throw new Error('x'); } });
    expect(s.localParallel).toEqual({ wanted: 1, applied: { ollama: null, lmstudio: null }, pending: false });
  });
});

describe('rotas plugáveis', () => {
  it('rota extra trata antes do 404; GET /goals lista', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row); createGoalAndTask(db, 'conta1', 'um');
    const s = await startServer({
      db, port: 0, token: 'seg', onGoal: async () => ({ goalId: 'g0', done: Promise.resolve() }), onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); },
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
