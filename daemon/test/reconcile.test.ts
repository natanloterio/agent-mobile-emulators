import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { getIdentity, setIdentityState, upsertIdentity } from '../src/db/identities.js';
import { createGoal, createTask, setTaskState, writeIntent } from '../src/db/tasks.js';
import { addSubtask, createMission, getMission } from '../src/db/missions.js';
import { reconcileOnStart } from '../src/fleet/reconcile.js';

const row = { id: 'conta1', name: 'conta1', handle: '@a', avdName: 'a', serial: 'emulator-5554', consolePort: 5554, mcpHostPort: 8080, mcpToken: 't', deviceSlug: 'conta1', appPackage: 'p', appVersionName: 'v', state: 'idle' as const };

describe('reconcileOnStart (spec §4.3: recuperação de crash)', () => {
  it('tarefa em voo vira failed, passo sem conclusão é marcado para verificação, identidade running volta a idle e o objetivo fecha', () => {
    const db = openDb(':memory:'); upsertIdentity(db, row); upsertIdentity(db, { ...row, id: 'conta2', name: 'conta2' });
    const g = createGoal(db, { text: 'x', pattern: 'fan-out', rationale: 'r', planJson: '{}' });
    const t1 = createTask(db, g, 'conta1', 'i', 'running'); const t2 = createTask(db, g, 'conta2', 'i');
    const done = createGoal(db, { text: 'antigo', pattern: 'fan-out', rationale: 'r', planJson: '{}' });
    const t3 = createTask(db, done, 'conta2', 'i'); setTaskState(db, t3, 'done');
    db.prepare("update goal set state='running'").run();
    writeIntent(db, t1, 'android_conta1_click_node', { id: 'n1' }, 'k1');
    setIdentityState(db, 'conta1', 'running');
    const r = reconcileOnStart(db);
    expect(r).toEqual({ tasks: 2, steps: 1, identities: 1, goals: 2, subtasks: 0 });
    const tasks = db.prepare('select id, state from task order by created_at, rowid').all() as { id: string; state: string }[];
    expect(tasks.map((t) => t.state)).toEqual(['failed', 'failed', 'done']);
    const step = db.prepare('select error, finished_at from step').get() as { error: string; finished_at: string | null };
    expect(step.error).toMatch(/daemon reiniciou/); expect(step.finished_at).toBeTruthy();
    expect(getIdentity(db, 'conta1')?.state).toBe('idle');
    const goals = db.prepare('select text, state, finished_at from goal order by created_at, rowid').all() as { text: string; state: string; finished_at: string | null }[];
    expect(goals.map((x) => x.state)).toEqual(['failed', 'done']);
    expect(goals.every((x) => x.finished_at)).toBe(true);
    expect(t2).toBeTruthy();
  });
  it('banco limpo: nada a fazer', () => {
    const db = openDb(':memory:');
    expect(reconcileOnStart(db)).toEqual({ tasks: 0, steps: 0, identities: 0, goals: 0, subtasks: 0 });
  });
  it('missão: subtarefa em voo vira interrupted, a missão fica running para retomar', () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const m = createMission(db, 'conta1', 'missão', 'pt'); const t = addSubtask(db, m, 'x', 'y');
    writeIntent(db, t, 'android_conta1_click_node', { id: 'n1' }, 'k1');
    setIdentityState(db, 'conta1', 'running');
    expect(reconcileOnStart(db)).toEqual({ tasks: 0, steps: 1, identities: 1, goals: 0, subtasks: 1 });
    expect((db.prepare('select state from task where id=?').get(t) as { state: string }).state).toBe('interrupted');
    expect(getMission(db, m)?.state).toBe('running');
    expect((db.prepare('select finished_at from goal where id=?').get(m) as { finished_at: string | null }).finished_at).toBeNull();
  });
});
