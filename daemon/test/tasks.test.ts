import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { upsertIdentity } from '../src/db/identities.js';
import { addSubtask, createMission, setMissionState } from '../src/db/missions.js';
import { createGoal, createTask, isFleetIdle, setTaskState } from '../src/db/tasks.js';

const row = { id: 'conta1', name: 'conta1', handle: '@a', avdName: 'avd1', serial: 'emulator-5554', consolePort: 5554, mcpHostPort: 8080, mcpToken: 't', deviceSlug: 'conta1', appPackage: 'com.instagram.android', appVersionName: '448.0.0.52.84', state: 'idle' as const };

describe('isFleetIdle (spec paralelismo §Ocioso)', () => {
  it('sem nenhuma tarefa: ociosa', () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    expect(isFleetIdle(db)).toBe(true);
  });
  it('tarefa "todo" de um goal "running" conta como ocupada (startGoal cria assim, antes do stagger)', () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const goalId = createGoal(db, { text: 'x', pattern: 'fan-out', rationale: 'r', planJson: '{}' });
    createTask(db, goalId, 'conta1', 'faz x'); // default state 'todo'
    expect(isFleetIdle(db)).toBe(false);
  });
  it('tarefa "running" de um goal "running": ocupada', () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const goalId = createGoal(db, { text: 'x', pattern: 'fan-out', rationale: 'r', planJson: '{}' });
    createTask(db, goalId, 'conta1', 'faz x', 'running');
    expect(isFleetIdle(db)).toBe(false);
  });
  it('tarefa "todo"/"running" de um goal já terminado: ociosa (o goal não roda mais)', () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const goalId = createGoal(db, { text: 'x', pattern: 'fan-out', rationale: 'r', planJson: '{}' });
    const taskId = createTask(db, goalId, 'conta1', 'faz x', 'running');
    setTaskState(db, taskId, 'done');
    expect(isFleetIdle(db)).toBe(true); // done: nem 'running' nem 'todo'
  });
  it('subtarefa de missão "running": ocupada (missão pausada com a subtarefa ainda "running" no banco também)', () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const missionId = createMission(db, 'conta1', 'objetivo', 'pt');
    addSubtask(db, missionId, 'passo 1', 'critério');
    expect(isFleetIdle(db)).toBe(false);
    // Pausar a missão (mission_state) não muda o goal.state (segue 'running' — spec missões) nem a subtarefa por si só.
    setMissionState(db, missionId, 'paused');
    expect(isFleetIdle(db)).toBe(false);
  });
  it('subtarefa de missão marcada "interrupted": ociosa', () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const missionId = createMission(db, 'conta1', 'objetivo', 'pt');
    const taskId = addSubtask(db, missionId, 'passo 1', 'critério');
    setTaskState(db, taskId, 'interrupted');
    expect(isFleetIdle(db)).toBe(true);
  });
});
