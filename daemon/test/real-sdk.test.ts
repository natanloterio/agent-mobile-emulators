import { tool } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { openDb } from '../src/db/open.js';
import { getIdentity, upsertIdentity } from '../src/db/identities.js';
import { runTask, type RunTaskDeps } from '../src/worker/run.js';

/** Estes testes usam o generateText REAL do ai@7; só o modelo é mock. É a única forma de pegar contratos do SDK. */
const row = { id: 'conta1', name: 'conta1', handle: '@a', avdName: 'x', serial: 's', consolePort: 5554, mcpHostPort: 8080, mcpToken: 't', deviceSlug: 'conta1', appPackage: 'com.instagram.android', appVersionName: '1', state: 'idle' as const };
const SCREEN = 'screen:1080x2400 density:420 orientation:portrait\n--- window:1 type:APPLICATION pkg:com.instagram.android title:Instagram layer:0 focused:true ---\nnode_id\tclass\ttext\tdesc\tres_id\tbounds\tflags\nnode_ok\tTextView\tFeed\t-\t-\t0,0,10,10\ton,clk,ena\nnode_ff01\tButton\tEnviar\t-\t-\t0,20,10,30\ton,clk,ena\n';

const usage = { inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } };
const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }], finishReason: { unified: 'stop' as const }, usage, warnings: [] });
const calls = (...c: { id: string; name: string; input: unknown }[]) => ({
  content: c.map((x) => ({ type: 'tool-call' as const, toolCallId: x.id, toolName: x.name, input: JSON.stringify(x.input) })),
  finishReason: { unified: 'tool-calls' as const }, usage, warnings: [],
});

const mcp: RunTaskDeps['connect'] = async () => ({
  tools: async () => ({
    android_conta1_get_screen_state: tool({ description: 'tela', inputSchema: z.object({}), execute: async () => SCREEN }),
    android_conta1_tap_node: tool({ description: 'tap', inputSchema: z.object({ node_id: z.string() }), execute: async () => 'Tap performed' }),
  }),
  close: async () => {},
});

describe('runTask com o generateText real', () => {
  it('C1: a instrução de sistema chega ao modelo e a tarefa termina done (não InvalidPromptError)', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const model = new MockLanguageModelV4({ doGenerate: [text('resumo final')] as never });
    const r = await runTask({ db, identity: row, goalText: 'g', apiKey: 'k', isKilled: () => false, onStep: () => {} }, { connect: mcp, model });
    expect(r.outcome).toBe('done');
    expect(r.summary).toBe('resumo final');
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(model.doGenerateCalls[0].prompt[0].role).toBe('system');
  });

  it('C2: gate negado, tool alucinada e resultado normal ficam registrados em step com excerpt/erro', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const model = new MockLanguageModelV4({ doGenerate: [
      calls({ id: 'c1', name: 'android_conta1_get_screen_state', input: {} }),
      calls({ id: 'c2', name: 'android_conta1_tap_node', input: { node_id: 'node_ff01' } }, { id: 'c3', name: 'android_conta1_launch_app', input: {} }),
      text('fim'),
    ] as never });
    const r = await runTask({ db, identity: row, goalText: 'g', apiKey: 'k', isKilled: () => false, onStep: () => {} }, { connect: mcp, model });
    expect(r.outcome).toBe('done');
    const rows = db.prepare('select tool, result_excerpt, error from step where task_id=? order by idx').all(r.taskId) as { tool: string; result_excerpt: string; error: string | null }[];
    const by = (t: string) => rows.find((x) => x.tool === t);
    expect(by('android_conta1_get_screen_state')?.result_excerpt).toMatch(/screen:1080x2400/);
    expect(by('android_conta1_tap_node')?.result_excerpt).toMatch(/^GATE/);
    expect(by('android_conta1_launch_app')?.result_excerpt).toMatch(/^ERRO/);
    expect(by('android_conta1_launch_app')?.error).toBeTruthy();
    expect(getIdentity(db, 'conta1')?.state).toBe('idle');
    expect(r.usage.inputTokens).toBe(300);
  });
});

import { PAGE1 as SCREEN_P1, PAGE2 as SCREEN_P2, PAGE2_CHECKPOINT } from './fixtures/paged.js';
const opts = (db: ReturnType<typeof openDb>) => ({ db, identity: row, goalText: 'g', apiKey: 'k', isKilled: () => false, onStep: () => {} });
const mkMcp = (tools: Record<string, unknown>): RunTaskDeps['connect'] => async () => ({ tools: async () => tools as never, close: async () => {} });
const screenTool = (fn: (i: { cursor?: string }) => unknown) => tool({ description: 'tela', inputSchema: z.object({ cursor: z.string().optional() }), execute: async (i) => fn(i) });
const tapTool = tool({ description: 'tap', inputSchema: z.object({ node_id: z.string() }), execute: async () => 'Tap performed' });
const stepsOf = (db: ReturnType<typeof openDb>, taskId: string) => db.prepare('select tool, result_excerpt, error from step where task_id=? order by idx').all(taskId) as { tool: string; result_excerpt: string; error: string | null }[];
const taskState = (db: ReturnType<typeof openDb>, taskId: string) => (db.prepare('select state from task where id=?').get(taskId) as { state: string }).state;

describe('runTask — revisão final', () => {
  it('I1: tool use paralelo desligado e, após uma ação, o gate nega até nova leitura', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const model = new MockLanguageModelV4({ doGenerate: [
      calls({ id: 'c1', name: 'android_conta1_get_screen_state', input: {} }),
      calls({ id: 'c2', name: 'android_conta1_tap_node', input: { node_id: 'node_ok' } }),
      calls({ id: 'c3', name: 'android_conta1_tap_node', input: { node_id: 'node_ok' } }),
      text('fim'),
    ] as never });
    const r = await runTask(opts(db), { connect: mkMcp({ android_conta1_get_screen_state: screenTool(() => SCREEN), android_conta1_tap_node: tapTool }), model });
    expect(r.outcome).toBe('done');
    const po = model.doGenerateCalls[0].providerOptions as { anthropic?: { disableParallelToolUse?: boolean } } | undefined;
    expect(po?.anthropic?.disableParallelToolUse).toBe(true);
    const taps = stepsOf(db, r.taskId).filter((s) => s.tool === 'android_conta1_tap_node');
    expect(taps[0]?.result_excerpt).toMatch(/Tap performed/);
    expect(taps[1]?.result_excerpt).toMatch(/^GATE/);
  });
  it('I3: worker segue o cursor e o gate enxerga nós da página 2', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const seen: unknown[] = [];
    const model = new MockLanguageModelV4({ doGenerate: [calls({ id: 'c1', name: 'android_conta1_get_screen_state', input: {} }), calls({ id: 'c2', name: 'android_conta1_tap_node', input: { node_id: 'node_p2' } }), text('fim')] as never });
    const r = await runTask(opts(db), { connect: mkMcp({ android_conta1_get_screen_state: screenTool((i) => { seen.push(i.cursor ?? null); return i.cursor ? SCREEN_P2 : SCREEN_P1; }), android_conta1_tap_node: tapTool }), model });
    expect(seen).toEqual([null, 'k7x9q.2']);
    expect(stepsOf(db, r.taskId).find((s) => s.tool === 'android_conta1_tap_node')?.result_excerpt).toMatch(/Tap performed/);
  });
  it('I3: checkpoint que só aparece na página 2 é detectado (janelas fundidas)', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const model = new MockLanguageModelV4({ doGenerate: [calls({ id: 'c1', name: 'android_conta1_get_screen_state', input: {} }), text('fim')] as never });
    const r = await runTask(opts(db), { connect: mkMcp({ android_conta1_get_screen_state: screenTool((i) => (i.cursor ? PAGE2_CHECKPOINT : SCREEN_P1)) }), model });
    expect(r.outcome).toBe('platform-block'); expect(r.platformBlock).toMatch(/Confirme/);
    expect(model.doGenerateCalls).toHaveLength(1);
  });
  it('I3: texto entregue ao modelo não contém as notas de paginação', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const model = new MockLanguageModelV4({ doGenerate: [calls({ id: 'c1', name: 'android_conta1_get_screen_state', input: {} }), text('fim')] as never });
    await runTask(opts(db), { connect: mkMcp({ android_conta1_get_screen_state: screenTool((i) => (i.cursor ? SCREEN_P2 : SCREEN_P1)) }), model });
    const prompt = JSON.stringify(model.doGenerateCalls[1]?.prompt ?? model.doGenerateCalls[0].prompt);
    expect(prompt).not.toMatch(/more nodes available|end of snapshot/);
    expect(prompt).toMatch(/node_p1/); expect(prompt).toMatch(/node_p2/);
  });
  it('I4: erro benigno de tool ("Node not found within timeout") não vira infra', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const waitTool = tool({ description: 'w', inputSchema: z.object({}), execute: async () => { throw new Error('Node not found within timeout'); } });
    const model = new MockLanguageModelV4({ doGenerate: [calls({ id: 'c1', name: 'android_conta1_wait_for_node', input: {} }), text('fim')] as never });
    const r = await runTask(opts(db), { connect: mkMcp({ android_conta1_get_screen_state: screenTool(() => SCREEN), android_conta1_wait_for_node: waitTool }), model });
    expect(r.outcome).toBe('done'); expect(getIdentity(db, 'conta1')?.state).toBe('idle');
    expect(stepsOf(db, r.taskId)[0]?.result_excerpt).toMatch(/^ERRO/);
  });
  it('I4/I5: 401 do MCP → infra, tarefa failed (token rotacionado não se resolve com retry), identidade offline', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const model = new MockLanguageModelV4({ doGenerate: [calls({ id: 'c1', name: 'android_conta1_get_screen_state', input: {} }), text('fim')] as never });
    const r = await runTask(opts(db), { connect: mkMcp({ android_conta1_get_screen_state: screenTool(() => { throw new Error('HTTP 401 Unauthorized'); }) }), model });
    expect(r.outcome).toBe('infra'); expect(taskState(db, r.taskId)).toBe('failed'); expect(getIdentity(db, 'conta1')?.state).toBe('offline');
  });
  it('I5: device sumiu → infra, tarefa todo, identidade offline', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const model = new MockLanguageModelV4({ doGenerate: [calls({ id: 'c1', name: 'android_conta1_get_screen_state', input: {} }), text('fim')] as never });
    const r = await runTask(opts(db), { connect: mkMcp({ android_conta1_get_screen_state: screenTool(() => { throw new Error("adb: device 'emulator-5554' not found"); }) }), model });
    expect(r.outcome).toBe('infra'); expect(taskState(db, r.taskId)).toBe('todo'); expect(getIdentity(db, 'conta1')?.state).toBe('offline');
  });
  it('I4: erro do próprio modelo (chave ruim) → failed, identidade continua idle', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const model = new MockLanguageModelV4({ doGenerate: async () => { throw new Error('401 authentication_error: invalid x-api-key'); } });
    const r = await runTask(opts(db), { connect: mkMcp({ android_conta1_get_screen_state: screenTool(() => SCREEN) }), model });
    expect(r.outcome).toBe('failed'); expect(taskState(db, r.taskId)).toBe('failed'); expect(getIdentity(db, 'conta1')?.state).toBe('idle');
  });
  it('I6: resultado MCP com isError vira ERRO e não atualiza a tela (tap seguinte é negado)', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const model = new MockLanguageModelV4({ doGenerate: [calls({ id: 'c1', name: 'android_conta1_get_screen_state', input: {} }), calls({ id: 'c2', name: 'android_conta1_tap_node', input: { node_id: 'node_ok' } }), text('fim')] as never });
    const r = await runTask(opts(db), { connect: mkMcp({ android_conta1_get_screen_state: screenTool(() => ({ content: [{ type: 'text', text: 'Accessibility service not connected' }], isError: true })), android_conta1_tap_node: tapTool }), model });
    const rows = stepsOf(db, r.taskId);
    expect(rows.find((s) => s.tool === 'android_conta1_get_screen_state')?.result_excerpt).toMatch(/^ERRO/);
    expect(rows.find((s) => s.tool === 'android_conta1_tap_node')?.result_excerpt).toMatch(/^GATE/);
  });
  it('I10: a intenção existe no banco ANTES da tool executar', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    let pendingAtExec = -1;
    const probe = tool({ description: 'p', inputSchema: z.object({}), execute: async () => { pendingAtExec = (db.prepare('select count(*) as n from step where finished_at is null').get() as { n: number }).n; return 'ok'; } });
    const model = new MockLanguageModelV4({ doGenerate: [calls({ id: 'c1', name: 'android_conta1_find_nodes', input: {} }), text('fim')] as never });
    await runTask(opts(db), { connect: mkMcp({ android_conta1_get_screen_state: screenTool(() => SCREEN), android_conta1_find_nodes: probe }), model });
    expect(pendingAtExec).toBe(1);
    expect((db.prepare('select count(*) as n from step where finished_at is null').get() as { n: number }).n).toBe(0);
  });
});

/** Espelha o mcpToModelOutput do @ai-sdk/mcp (dist/index.js:2583): recebe { output }; shape MCP vira content, o resto vira json.
 *  Com output string, `'content' in output` lança TypeError — foi o que derrubou a primeira execução real. */
const mcpToModelOutput = ({ output }: { output: unknown }) => {
  const result = output as { content?: unknown };
  if (!('content' in (result as object)) || !Array.isArray(result.content)) return { type: 'json' as const, value: output as never };
  return { type: 'content' as const, value: result.content as { type: 'text'; text: string }[] };
};

describe('runTask — tools reais do @ai-sdk/mcp (shape MCP + toModelOutput)', () => {
  it('screen state paginado devolvido no shape MCP passa pelo toModelOutput e a tarefa termina done', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const inputsSeen: unknown[] = [];
    const mcpScreen = tool({ description: 'tela', inputSchema: z.object({ include_screenshot: z.boolean().optional(), cursor: z.string().optional() }),
      execute: async (i) => { inputsSeen.push(i); return { content: [{ type: 'text', text: i.cursor ? SCREEN_P2 : SCREEN_P1 }] }; }, toModelOutput: mcpToModelOutput });
    const mcpTap = tool({ description: 'tap', inputSchema: z.object({ node_id: z.string() }), execute: async () => ({ content: [{ type: 'text', text: 'Tap performed' }] }), toModelOutput: mcpToModelOutput });
    const model = new MockLanguageModelV4({ doGenerate: [
      calls({ id: 'c1', name: 'android_conta1_get_screen_state', input: { include_screenshot: true } }),
      calls({ id: 'c2', name: 'android_conta1_tap_node', input: { node_id: 'node_p2' } }),
      text('fim'),
    ] as never });
    const r = await runTask(opts(db), { connect: mkMcp({ android_conta1_get_screen_state: mcpScreen, android_conta1_tap_node: mcpTap }), model });
    expect(r.outcome).toBe('done');
    expect(stepsOf(db, r.taskId).find((s) => s.tool === 'android_conta1_get_screen_state')?.result_excerpt).toMatch(/node_p1/);
    expect(stepsOf(db, r.taskId).find((s) => s.tool === 'android_conta1_tap_node')?.result_excerpt).toMatch(/Tap performed/);
    // o parser não usa imagem; screenshot custa tokens à toa neste incremento
    expect((inputsSeen[0] as { include_screenshot?: boolean }).include_screenshot).toBe(false);
  });
});
