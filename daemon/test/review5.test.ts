import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { getIdentity, setIdentityState, upsertIdentity, type IdentityRow } from '../src/db/identities.js';
import { createGoal, createTask, finishGoal } from '../src/db/tasks.js';
import type { ProbeResult } from '../src/device/probe.js';
import { probeFleet } from '../src/leader/readiness.js';
import { startServer } from '../src/server/api.js';
import { goalsRoutes } from '../src/server/routes-goals.js';
import { createIdentityRoutes, type IdentityOps } from '../src/server/routes-identities.js';
import { currentGoal } from '../src/server/snapshot.js';
import { humanStopped, settleIdentity } from '../src/worker/stop.js';

const base: IdentityRow = { id: 'conta1', name: 'conta1', handle: '@a', avdName: 'a', serial: 'emulator-5554', consolePort: 5554, mcpHostPort: 8080, mcpToken: 't', deviceSlug: 'conta1', appPackage: 'p', appVersionName: 'v', state: 'idle' };
const READY: ProbeResult = { ready: true, signals: { bootCompleted: true, accessibility: true, mcpInitialize: true, toolsPresent: true, versionMatch: true }, details: [], failureClass: null };
const closers: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(closers.splice(0).map((c) => c())); });

describe('revisão do incremento 5', () => {
  it('alto: identidade sem login não é sondada nem fica pronta', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, { ...base, id: 'conta2', name: 'conta2', handle: 'sem conta', state: 'provisioned' });
    const probed: string[] = [];
    const fleet = await probeFleet(db, async (i) => { probed.push(i.id); return READY; });
    expect(probed).toEqual([]);
    expect(fleet[0]).toMatchObject({ ready: false, readyLabel: 'aguardando login' });
    expect(getIdentity(db, 'conta2')?.state).toBe('provisioned');
  });
  it('médio: banir no meio da tarefa para o worker e o fim não desfaz o banimento', () => {
    const db = openDb(':memory:'); upsertIdentity(db, { ...base, state: 'running' });
    expect(humanStopped(db, 'conta1')).toBe(false);
    setIdentityState(db, 'conta1', 'banned', { bannedReason: 'x' });
    expect(humanStopped(db, 'conta1')).toBe(true);
    settleIdentity(db, 'conta1');
    expect(getIdentity(db, 'conta1')?.state).toBe('banned');
  });
  it('médio: planejamento toma o lock do objetivo (POST /goals → 409 enquanto planeja)', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, base);
    let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
    const s = await startServer({
      db, port: 0, token: 'seg', onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); },
      onGoal: async () => ({ goalId: 'g', done: Promise.resolve() }) as never,
      routes: [goalsRoutes({ plan: async (text) => { await gate; return { text } as never; } })],
    }); closers.push(s.close);
    const h = { authorization: 'Bearer seg', 'content-type': 'application/json' };
    const planning = fetch(`http://127.0.0.1:${s.port}/goals/plan`, { method: 'POST', headers: h, body: JSON.stringify({ text: 'objetivo' }) });
    await new Promise((r) => setTimeout(r, 20));
    expect((await fetch(`http://127.0.0.1:${s.port}/goals`, { method: 'POST', headers: h, body: JSON.stringify({ text: 'objetivo' }) })).status).toBe(409);
    expect((await fetch(`http://127.0.0.1:${s.port}/goals/plan`, { method: 'POST', headers: h, body: JSON.stringify({ text: 'objetivo' }) })).status).toBe(409);
    release(); expect((await planning).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${s.port}/goals`, { method: 'POST', headers: h, body: JSON.stringify({ text: 'objetivo' }) })).status).toBe(202);
  });
  it('médio: restore recusa identidade com tarefa pendente num objetivo aberto', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, base);
    db.prepare("update identity set snapshot_taken_at='2026-09-26T11:00:00Z'").run();
    const g = createGoal(db, { text: 'x', pattern: 'fan-out', rationale: 'r', planJson: '{}' }); createTask(db, g, 'conta1', 'i');
    const ops: IdentityOps = {
      adb: { devices: async () => ['emulator-5554'], emu: async () => 'OK', trimCaches: async () => {} },
      clone: async () => {}, deleteAvd: async () => {}, boot: async (i) => i, leasePorts: async () => ({ consolePort: 5556, mcpHostPort: 8081 }),
      ensureReady: async () => READY, now: () => new Date('2026-09-26T12:00:00Z'), killSleep: async () => {},
    };
    const ir = createIdentityRoutes(ops);
    const s = await startServer({ db, port: 0, token: 'seg', onGoal: async () => {}, onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); }, routes: [ir.route] } as never); closers.push(s.close);
    const post = (p: string) => fetch(`http://127.0.0.1:${s.port}${p}`, { method: 'POST', headers: { authorization: 'Bearer seg', 'content-type': 'application/json' }, body: '{}' });
    expect((await post('/identities/conta1/restore')).status).toBe(409);
    expect((await post('/identities/conta1/rebaseline')).status).toBe(409);
    finishGoal(db, g);
    expect((await post('/identities/conta1/restore')).status).toBe(200);
    await ir.settle();
  });
  it('médio: objetivo fechado não mostra tarefa rodando', () => {
    const db = openDb(':memory:'); upsertIdentity(db, base);
    const g = createGoal(db, { text: 'x', pattern: 'fan-out', rationale: 'r', planJson: '{}' }); createTask(db, g, 'conta1', 'i');
    db.prepare("update goal set state='running'").run();
    expect(currentGoal(db)?.tasksRunning).toBe(1);
    finishGoal(db, g);
    expect(currentGoal(db)).toMatchObject({ state: 'failed', tasksRunning: 0 });
  });
});
