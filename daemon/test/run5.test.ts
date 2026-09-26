import { tool } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { openDb } from '../src/db/open.js';
import { getIdentity, setIdentityFlags, setIdentityState, upsertIdentity } from '../src/db/identities.js';
import { createGoal, createTask } from '../src/db/tasks.js';
import { runTask, type RunTaskDeps } from '../src/worker/run.js';

/** Incremento 5: runTask dirigido pelo scheduler (goal/task/instrução vindos de fora), parada por pausa/controle e pacing. */
const row = { id: 'conta1', name: 'conta1', handle: '@a', avdName: 'x', serial: 's', consolePort: 5554, mcpHostPort: 8080, mcpToken: 't', deviceSlug: 'conta1', appPackage: 'com.instagram.android', appVersionName: '1', state: 'idle' as const };
const SCREEN = 'screen:1080x2400 density:420 orientation:portrait\n--- window:1 type:APPLICATION pkg:com.instagram.android title:Instagram layer:0 focused:true ---\nnode_id\tclass\ttext\tdesc\tres_id\tbounds\tflags\nnode_ok\tTextView\tFeed\t-\t-\t0,0,10,10\ton,clk,ena\n';
const usage = { inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } };
const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }], finishReason: { unified: 'stop' as const }, usage, warnings: [] });
const call = (id: string, name: string, input: unknown) => ({ content: [{ type: 'tool-call' as const, toolCallId: id, toolName: name, input: JSON.stringify(input) }], finishReason: { unified: 'tool-calls' as const }, usage, warnings: [] });
const CLOUD = { role: 'esc' as const, mode: 'nuvem' as const, model: 'claude-haiku-4-5', endpoint: 'anthropic' };
const PROVIDERS = { lider: { ...CLOUD, role: 'lider' as const, model: 'claude-sonnet-5' }, worker: { ...CLOUD, role: 'worker' as const }, esc: CLOUD };
const mcp: RunTaskDeps['connect'] = async () => ({
  tools: async () => ({ android_conta1_get_screen_state: tool({ description: 'tela', inputSchema: z.object({}), execute: async () => SCREEN }) }),
  close: async () => {},
});
const screens = (n: number) => [...Array.from({ length: n }, (_, i) => call(`c${i}`, 'android_conta1_get_screen_state', {})), text('fim')];
type Db = ReturnType<typeof openDb>;
const task = (db: Db, id: string) => db.prepare('select state, attempts, goal_id from task where id=?').get(id) as { state: string; attempts: number; goal_id: string };
const goal = (db: Db, id: string) => db.prepare('select state, finished_at from goal where id=?').get(id) as { state: string; finished_at: string | null };

describe('runTask — incremento 5', () => {
  it('usa goal/task do scheduler e a instrução da tarefa (não cria outro objetivo)', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const goalId = createGoal(db, { text: 'objetivo geral', pattern: 'sharding', rationale: 'r', planJson: '{}' });
    const taskId = createTask(db, goalId, 'conta1', 'fatia 1 de 2: itens ímpares');
    const model = new MockLanguageModelV4({ doGenerate: [text('fim')] as never });
    const r = await runTask({ db, identity: row, goalText: 'objetivo geral', goalId, taskId, instruction: 'fatia 1 de 2: itens ímpares', apiKey: 'k', isKilled: () => false, onStep: () => {}, providers: PROVIDERS }, { connect: mcp, model });
    expect(r.taskId).toBe(taskId); expect(r.outcome).toBe('done');
    expect(task(db, taskId)).toMatchObject({ state: 'done', attempts: 1, goal_id: goalId });
    expect((db.prepare('select count(*) as n from goal').get() as { n: number }).n).toBe(1);
    expect(JSON.stringify(model.doGenerateCalls[0].prompt)).toMatch(/fatia 1 de 2: itens ímpares/);
    expect(goal(db, goalId).state).toBe('running'); // quem fecha o objetivo é o scheduler
  });
  it('só goalId: cria a tarefa dentro do objetivo', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const goalId = createGoal(db, { text: 'g', pattern: 'fan-out', rationale: 'r', planJson: '{}' });
    const r = await runTask({ db, identity: row, goalText: 'g', goalId, apiKey: 'k', isKilled: () => false, onStep: () => {}, providers: PROVIDERS }, { connect: mcp, model: new MockLanguageModelV4({ doGenerate: [text('fim')] as never }) });
    expect(task(db, r.taskId).goal_id).toBe(goalId);
  });
  it('assinatura antiga: cria objetivo próprio e o fecha ao terminar', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const r = await runTask({ db, identity: row, goalText: 'g', apiKey: 'k', isKilled: () => false, onStep: () => {}, providers: PROVIDERS }, { connect: mcp, model: new MockLanguageModelV4({ doGenerate: [text('fim')] as never }) });
    const g = goal(db, task(db, r.taskId).goal_id);
    expect(g.state).toBe('done'); expect(g.finished_at).toBeTruthy();
  });
  it('controle humano no meio: worker para, tarefa volta a todo, flag preservada, running → idle', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const model = new MockLanguageModelV4({ doGenerate: screens(4) as never });
    const r = await runTask({ db, identity: row, goalText: 'g', apiKey: 'k', isKilled: () => false, providers: PROVIDERS,
      onStep: () => setIdentityFlags(db, 'conta1', { controlled: true }) }, { connect: mcp, model });
    expect(r.outcome).toBe('interrupted'); expect(model.doGenerateCalls).toHaveLength(1);
    expect(task(db, r.taskId).state).toBe('todo');
    expect(getIdentity(db, 'conta1')).toMatchObject({ controlled: true, state: 'idle' });
  });
  it('pausa no meio com estado mudado pelo humano: o estado dele não é sobrescrito', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const model = new MockLanguageModelV4({ doGenerate: screens(4) as never });
    const r = await runTask({ db, identity: row, goalText: 'g', apiKey: 'k', isKilled: () => false, providers: PROVIDERS,
      onStep: () => { setIdentityFlags(db, 'conta1', { paused: true }); setIdentityState(db, 'conta1', 'needs-human', { lastError: 'humano viu captcha' }); } }, { connect: mcp, model });
    expect(r.outcome).toBe('interrupted');
    expect(getIdentity(db, 'conta1')).toMatchObject({ paused: true, state: 'needs-human', lastError: 'humano viu captcha' });
  });
  it('pacer roda antes de cada passo; stop do pacer tira as tools do passo', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const model = new MockLanguageModelV4({ doGenerate: screens(2) as never });
    let n = 0;
    const r = await runTask({ db, identity: row, goalText: 'g', apiKey: 'k', isKilled: () => false, onStep: () => {}, providers: PROVIDERS },
      { connect: mcp, model, pacer: { beforeStep: async () => (++n >= 2 ? 'stop' : 'go') } });
    expect(n).toBeGreaterThanOrEqual(2);
    expect(model.doGenerateCalls[0].tools?.length ?? 0).toBeGreaterThan(0);
    expect(model.doGenerateCalls[1].tools?.length ?? 0).toBe(0);
    expect(r.taskId).toBeTruthy();
  });
});
