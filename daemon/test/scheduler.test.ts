import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { setIdentityFlags, setIdentityState, upsertIdentity, type IdentityRow } from '../src/db/identities.js';
import { setTaskState } from '../src/db/tasks.js';
import type { ProbeResult } from '../src/device/probe.js';
import type { GoalPlan } from '../src/leader/types.js';
import { runGoal, startGoal, type WorkerJob } from '../src/swarm/scheduler.js';

const base = { avdName: 'x', consolePort: 5554, mcpHostPort: 8080, mcpToken: 't', appPackage: 'p', appVersionName: '1', state: 'idle' as const };
const mk = (n: number) => ({ ...base, id: `conta${n}`, name: `conta${n}`, handle: `@c${n}`, serial: `s${n}`, deviceSlug: `conta${n}` });
const OK = { bootCompleted: true, accessibility: true, mcpInitialize: true, toolsPresent: true, versionMatch: true };
type Db = ReturnType<typeof openDb>;

function fleet(n: number): Db { const db = openDb(':memory:'); for (let i = 1; i <= n; i++) upsertIdentity(db, mk(i)); return db; }
function planFor(ids: readonly [string, boolean][], pattern: GoalPlan['pattern'] = 'fan-out'): GoalPlan {
  return {
    text: 'objetivo', pattern, rationale: 'porque sim',
    tasks: ids.map(([id, ready]) => ({ identityId: id, name: id, handle: `@${id}`, instruction: `instrução de ${id}`, signals: OK, ready, readyLabel: ready ? 'pronto' : 'offline · x' })),
    estimate: { tasks: 0, outOfProbe: 0, stepBudget: 30, fleetReadyMs: 0 }, leader: { model: 'm', costUsd: 0, error: null },
  };
}
/** Worker falso: grava o estado final pedido por identidade (padrão done). */
function fakeWorker(db: Db, outcome: Record<string, 'done' | 'failed' | 'needs-human' | 'throw'> = {}) {
  const jobs: WorkerJob[] = [];
  const runWorker = async (j: WorkerJob) => {
    jobs.push(j);
    const o = outcome[j.identity.id] ?? 'done';
    if (o === 'throw') throw new Error('worker explodiu');
    setTaskState(db, j.taskId, o);
  };
  return { jobs, runWorker };
}
const clock = () => { const slept: number[] = []; return { slept, sleep: async (ms: number) => { slept.push(ms); }, random: () => 0.5 }; };
const tasksOf = (db: Db, goalId: string) => db.prepare('select identity_id, instruction, state from task where goal_id=? order by identity_id').all(goalId) as { identity_id: string; instruction: string; state: string }[];
const goalRow = (db: Db, id: string) => db.prepare('select pattern, rationale, plan_json, state, finished_at from goal where id=?').get(id) as { pattern: string; rationale: string; plan_json: string; state: string; finished_at: string | null };
const cfg = { staggerMs: 8000, jitterMs: 3000 };

describe('scheduler', () => {
  it('cria objetivo e uma tarefa por identidade pronta; starts escalonados com jitter; todas done → done', async () => {
    const db = fleet(3); const w = fakeWorker(db); const c = clock(); let changes = 0;
    const plan = planFor([['conta1', true], ['conta2', false], ['conta3', true]], 'sharding');
    const r = await runGoal(plan, { db, isKilled: () => false, runWorker: w.runWorker, ...cfg, sleep: c.sleep, random: c.random, onChange: () => { changes++; } });
    expect(r.state).toBe('done');
    const g = goalRow(db, r.goalId);
    expect(g).toMatchObject({ pattern: 'sharding', rationale: 'porque sim', state: 'done' }); expect(g.finished_at).toBeTruthy();
    expect(JSON.parse(g.plan_json).tasks).toHaveLength(3);
    expect(tasksOf(db, r.goalId)).toEqual([
      { identity_id: 'conta1', instruction: 'instrução de conta1', state: 'done' },
      { identity_id: 'conta3', instruction: 'instrução de conta3', state: 'done' },
    ]);
    expect([...c.slept].sort((a, b) => a - b)).toEqual([1500, 9500]);
    expect(w.jobs.map((j) => [j.identity.id, j.instruction, j.goalText])).toEqual([['conta1', 'instrução de conta1', 'objetivo'], ['conta3', 'instrução de conta3', 'objetivo']]);
    expect(changes).toBeGreaterThan(0);
  });
  it('startGoal devolve o goalId antes de rodar (a rota responde 202 com ele)', async () => {
    const db = fleet(1); const w = fakeWorker(db);
    const s = startGoal(planFor([['conta1', true]]), { db, isKilled: () => false, runWorker: w.runWorker, staggerMs: 0, jitterMs: 0 });
    expect(goalRow(db, s.goalId).state).toBe('running');
    expect(tasksOf(db, s.goalId)[0].state).toBe('todo');
    expect(await s.done).toBe('done');
  });
  it('needs-human numa identidade não bloqueia as outras → partial', async () => {
    const db = fleet(2); const w = fakeWorker(db, { conta1: 'needs-human' });
    const r = await runGoal(planFor([['conta1', true], ['conta2', true]]), { db, isKilled: () => false, runWorker: w.runWorker, staggerMs: 0, jitterMs: 0 });
    expect(w.jobs).toHaveLength(2); expect(r.state).toBe('partial');
  });
  it('nenhuma done → failed; worker que lança vira tarefa failed sem derrubar as outras', async () => {
    const db = fleet(2); const w = fakeWorker(db, { conta1: 'throw', conta2: 'failed' });
    const r = await runGoal(planFor([['conta1', true], ['conta2', true]]), { db, isKilled: () => false, runWorker: w.runWorker, staggerMs: 0, jitterMs: 0 });
    expect(r.state).toBe('failed'); expect(tasksOf(db, r.goalId).map((t) => t.state)).toEqual(['failed', 'failed']);
  });
  it('sem identidade pronta → objetivo failed na hora, nenhum worker', async () => {
    const db = fleet(1); const w = fakeWorker(db);
    const r = await runGoal(planFor([['conta1', false]]), { db, isKilled: () => false, runWorker: w.runWorker, staggerMs: 0, jitterMs: 0 });
    expect(r.state).toBe('failed'); expect(w.jobs).toHaveLength(0); expect(goalRow(db, r.goalId).finished_at).toBeTruthy();
  });
  it('re-checa no start: pausada/controlada/needs-human/banned/kill → pulada (failed com motivo no log), sem worker', async () => {
    const db = fleet(5); const w = fakeWorker(db);
    setIdentityFlags(db, 'conta1', { paused: true }); setIdentityFlags(db, 'conta2', { controlled: true });
    setIdentityState(db, 'conta3', 'needs-human'); setIdentityState(db, 'conta4', 'banned');
    const r = await runGoal(planFor([['conta1', true], ['conta2', true], ['conta3', true], ['conta4', true], ['conta5', true]]), { db, isKilled: () => false, runWorker: w.runWorker, staggerMs: 0, jitterMs: 0 });
    expect(w.jobs.map((j) => j.identity.id)).toEqual(['conta5']);
    expect(tasksOf(db, r.goalId).map((t) => t.state)).toEqual(['failed', 'failed', 'failed', 'failed', 'done']);
    const log = db.prepare("select s.result_excerpt as e from step s join task t on t.id=s.task_id where t.identity_id='conta1'").get() as { e: string };
    expect(log.e).toMatch(/^pulada: pausada/);
    expect(r.state).toBe('partial');
  });
  it('kill switch durante o escalonamento: quem ainda não começou é pulado', async () => {
    const db = fleet(2); const w = fakeWorker(db); let killed = false;
    const r = await runGoal(planFor([['conta1', true], ['conta2', true]]), { db, isKilled: () => killed, runWorker: async (j) => { await w.runWorker(j); killed = true; }, staggerMs: 10, jitterMs: 0, sleep: (ms) => new Promise((res) => setTimeout(res, ms)) });
    expect(w.jobs.map((j) => j.identity.id)).toEqual(['conta1']);
    expect(tasksOf(db, r.goalId).map((t) => t.state)).toEqual(['done', 'failed']);
  });
  it('re-sonda no start quando há ensureReady: sonda falha → pulada com rótulo offline e sinais gravados', async () => {
    const db = fleet(2); const w = fakeWorker(db);
    const bad: ProbeResult = { ready: false, signals: { ...OK, bootCompleted: false }, details: ['boot incompleto'], failureClass: 'infra' };
    const ensureReady = async (id: IdentityRow): Promise<ProbeResult> => (id.id === 'conta2' ? bad : { ready: true, signals: OK, details: [], failureClass: null });
    const r = await runGoal(planFor([['conta1', true], ['conta2', true]]), { db, isKilled: () => false, runWorker: w.runWorker, ensureReady, staggerMs: 0, jitterMs: 0 });
    expect(w.jobs.map((j) => j.identity.id)).toEqual(['conta1']);
    const log = db.prepare("select s.result_excerpt as e from step s join task t on t.id=s.task_id where t.identity_id='conta2'").get() as { e: string };
    expect(log.e).toBe('pulada: offline · boot incompleto');
    expect(r.state).toBe('partial');
  });
  it('identidade repetida no plano vira uma tarefa só; identidade inexistente é pulada', async () => {
    const db = fleet(1); const w = fakeWorker(db);
    const r = await runGoal(planFor([['conta1', true], ['conta1', true], ['fantasma', true]]), { db, isKilled: () => false, runWorker: w.runWorker, staggerMs: 0, jitterMs: 0 });
    expect(w.jobs).toHaveLength(1); expect(r.state).toBe('done');
  });
});
