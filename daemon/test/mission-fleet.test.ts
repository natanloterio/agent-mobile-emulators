import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { upsertIdentity } from '../src/db/identities.js';
import { createMission } from '../src/db/missions.js';
import type { ProbeResult } from '../src/device/probe.js';
import { readinessOf } from '../src/leader/readiness.js';
import { runGoal } from '../src/swarm/scheduler.js';

const row = { id: 'conta1', name: 'conta1', handle: '@a', avdName: 'x', serial: 's', consolePort: 5554, mcpHostPort: 8080, mcpToken: 't', deviceSlug: 'conta1', appPackage: 'p', appVersionName: '1', state: 'idle' as const };
const OK = { bootCompleted: true, accessibility: true, mcpInitialize: true, toolsPresent: true, versionMatch: true };
const ready: ProbeResult = { ready: true, signals: OK, details: [], failureClass: null };

describe('identidade em missão fica fora dos objetivos comuns', () => {
  it('readinessOf: "em missão", sem sondar', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row); createMission(db, 'conta1', 'm', 'pt');
    let probed = false;
    const r = await readinessOf(db, row, async () => { probed = true; return ready; });
    expect(r).toMatchObject({ ready: false, readyLabel: 'em missão' }); expect(probed).toBe(false);
  });
  it('scheduler: pula com motivo "em missão"', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row); createMission(db, 'conta1', 'm', 'pt');
    let ran = 0;
    const plan = { text: 'objetivo', pattern: 'fan-out' as const, rationale: 'r', tasks: [{ identityId: 'conta1', name: 'conta1', handle: '@a', instruction: 'i', signals: OK, ready: true, readyLabel: 'pronto' }], estimate: { tasks: 1, outOfProbe: 0, stepBudget: 30, fleetReadyMs: 0 }, leader: { model: 'm', costUsd: 0, error: null } };
    const r = await runGoal(plan, { db, isKilled: () => false, runWorker: async () => { ran++; }, staggerMs: 0, jitterMs: 0 });
    expect(ran).toBe(0); expect(r.state).toBe('failed');
    const step = db.prepare("select result_excerpt from step where tool='(scheduler)'").get() as { result_excerpt: string };
    expect(step.result_excerpt).toBe('pulada: em missão');
  });
  it('scheduler: missão iniciada durante a sonda → pula "em missão" (re-checa depois do await)', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    let ran = 0;
    const plan = { text: 'objetivo', pattern: 'fan-out' as const, rationale: 'r', tasks: [{ identityId: 'conta1', name: 'conta1', handle: '@a', instruction: 'i', signals: OK, ready: true, readyLabel: 'pronto' }], estimate: { tasks: 1, outOfProbe: 0, stepBudget: 30, fleetReadyMs: 0 }, leader: { model: 'm', costUsd: 0, error: null } };
    const ensureReady = async () => { createMission(db, 'conta1', 'm', 'pt'); return ready; };
    await runGoal(plan, { db, isKilled: () => false, runWorker: async () => { ran++; }, ensureReady, staggerMs: 0, jitterMs: 0 });
    expect(ran).toBe(0);
    const step = db.prepare("select result_excerpt from step where tool='(scheduler)'").get() as { result_excerpt: string };
    expect(step.result_excerpt).toBe('pulada: em missão');
  });
});
