import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { upsertIdentity } from '../src/db/identities.js';
import { createGoalAndTask } from '../src/db/tasks.js';
import { createPacer, recentActionTimes, stepDelayMs, toSqliteUtc } from '../src/swarm/pacing.js';

const row = { id: 'conta1', name: 'conta1', handle: '@a', avdName: 'x', serial: 's', consolePort: 5554, mcpHostPort: 8080, mcpToken: 't', deviceSlug: 'conta1', appPackage: 'p', appVersionName: '1', state: 'idle' as const };
const T0 = Date.parse('2026-09-26T12:00:00Z');

/** Relógio falso: `sleep` avança o tempo; registra cada espera. */
function fakeClock(start = T0) {
  let now = start; const slept: number[] = [];
  return { slept, clock: { now: () => now, random: () => 0.5, sleep: async (ms: number) => { slept.push(ms); now += ms; } } };
}
function seedActions(db: ReturnType<typeof openDb>, taskId: string, tools: readonly string[], at: number): void {
  const ins = db.prepare("insert into step (task_id, idx, tool, intent_written_at, started_at) values (?, ?, ?, datetime('now'), ?)");
  tools.forEach((t, i) => ins.run(taskId, i + 1, t, toSqliteUtc(at)));
}

describe('stepDelayMs', () => {
  it('base ± jitter, nunca negativo', () => {
    const cfg = { stepDelayMs: 1500, stepJitterMs: 1000, maxActionsPerHour: 0 };
    expect(stepDelayMs(cfg, () => 0)).toBe(500);
    expect(stepDelayMs(cfg, () => 0.5)).toBe(1500);
    expect(stepDelayMs(cfg, () => 0.999999)).toBe(2500);
    expect(stepDelayMs({ ...cfg, stepDelayMs: 100 }, () => 0)).toBe(0);
    expect(stepDelayMs({ stepDelayMs: 0, stepJitterMs: 0, maxActionsPerHour: 0 }, Math.random)).toBe(0);
  });
});

describe('recentActionTimes', () => {
  it('conta só tools de ação desta identidade dentro da janela', () => {
    const db = openDb(':memory:'); upsertIdentity(db, row); upsertIdentity(db, { ...row, id: 'conta2', name: 'conta2', deviceSlug: 'conta2' });
    const t1 = createGoalAndTask(db, 'conta1', 'g').taskId; const t2 = createGoalAndTask(db, 'conta2', 'g').taskId;
    seedActions(db, t1, ['android_conta1_tap_node', 'android_conta1_get_screen_state', 'ledger_record'], T0 - 60_000);
    seedActions(db, t2, ['android_conta2_tap_node'], T0 - 60_000);
    db.prepare("insert into step (task_id, idx, tool, intent_written_at, started_at) values (?, 9, 'android_conta1_scroll', datetime('now'), ?)").run(t1, toSqliteUtc(T0 - 2 * 3_600_000));
    expect(recentActionTimes(db, 'conta1', T0)).toEqual([T0 - 60_000]);
  });
});

describe('createPacer', () => {
  const cfg = { stepDelayMs: 1500, stepJitterMs: 1000, maxActionsPerHour: 0 };
  it('primeiro passo sem atraso; seguintes com atraso e jitter', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const { slept, clock } = fakeClock();
    const p = createPacer(db, 'conta1', cfg, { shouldStop: () => false, clock });
    expect(await p.beforeStep()).toBe('go'); expect(slept).toEqual([]);
    expect(await p.beforeStep()).toBe('go'); expect(slept).toEqual([1500]);
  });
  it('teto de ações/hora: espera a mais velha sair da janela em vez de agir', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const { taskId } = createGoalAndTask(db, 'conta1', 'g');
    seedActions(db, taskId, ['android_conta1_tap_node', 'android_conta1_scroll'], T0 - 3_590_000); // saem da janela em 10 s
    const { slept, clock } = fakeClock();
    const p = createPacer(db, 'conta1', { ...cfg, stepDelayMs: 0, stepJitterMs: 0, maxActionsPerHour: 2 }, { shouldStop: () => false, clock });
    expect(await p.beforeStep()).toBe('go');
    expect(slept.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(10_000);
  });
  it('parada (kill/pausa/controle) durante a espera → stop', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const { taskId } = createGoalAndTask(db, 'conta1', 'g');
    seedActions(db, taskId, ['android_conta1_tap_node'], T0 - 60_000);
    const { clock } = fakeClock(); let stop = false;
    const p = createPacer(db, 'conta1', { ...cfg, maxActionsPerHour: 1 }, { shouldStop: () => stop, clock: { ...clock, sleep: async (ms) => { stop = true; await clock.sleep(ms); } } });
    expect(await p.beforeStep()).toBe('stop');
  });
  it('teto 0 = sem teto', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const { taskId } = createGoalAndTask(db, 'conta1', 'g');
    seedActions(db, taskId, Array.from({ length: 50 }, () => 'android_conta1_tap_node'), T0 - 60_000);
    const { slept, clock } = fakeClock();
    expect(await createPacer(db, 'conta1', { stepDelayMs: 0, stepJitterMs: 0, maxActionsPerHour: 0 }, { shouldStop: () => false, clock }).beforeStep()).toBe('go');
    expect(slept).toEqual([]);
  });
});
