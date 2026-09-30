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

/** Testes do incremento 1 fixam a nuvem: o default de fábrica do worker é local desde o benchmark e tocaria o supervisor real do Ollama. */
const CLOUD = { role: 'esc' as const, mode: 'nuvem' as const, model: 'claude-haiku-4-5', endpoint: 'anthropic' };
const CLOUD_PROVIDERS = { lider: { ...CLOUD, role: 'lider' as const, model: 'claude-sonnet-5' }, worker: { ...CLOUD, role: 'worker' as const }, esc: CLOUD };

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
    const r = await runTask({ db, identity: row, goalText: 'g', apiKey: 'k', isKilled: () => false, onStep: () => {}, providers: CLOUD_PROVIDERS }, { connect: mcp, model });
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
    const r = await runTask({ db, identity: row, goalText: 'g', apiKey: 'k', isKilled: () => false, onStep: () => {}, providers: CLOUD_PROVIDERS }, { connect: mcp, model });
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
const opts = (db: ReturnType<typeof openDb>) => ({ db, identity: row, goalText: 'g', apiKey: 'k', isKilled: () => false, onStep: () => {}, providers: CLOUD_PROVIDERS });
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

describe('runTask — prompt caching (spec §4.3 lever 3)', () => {
  it('cacheControl 1h vai no nível da chamada (o schema da mensagem de sistema do provider não o aceita)', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const model = new MockLanguageModelV4({ doGenerate: [text('ok')] as never });
    await runTask(opts(db), { connect: mkMcp({ android_conta1_get_screen_state: screenTool(() => SCREEN) }), model });
    const po = model.doGenerateCalls[0].providerOptions as { anthropic?: { cacheControl?: { type: string; ttl?: string }; disableParallelToolUse?: boolean } } | undefined;
    expect(po?.anthropic?.cacheControl).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(po?.anthropic?.disableParallelToolUse).toBe(true);
  });
});

import { createOllamaSupervisor } from '../src/provider/ollama.js';

const invalid = (id: string) => calls({ id, name: 'android_conta1_tap_node', input: { wrong: true } });
const LOCAL = { role: 'worker' as const, mode: 'local' as const, model: 'qwen3.5:27b', endpoint: 'http://127.0.0.1:11434/v1' };
const ESC = { role: 'esc' as const, mode: 'nuvem' as const, model: 'claude-haiku-4-5', endpoint: 'anthropic' };
const LIDER = { role: 'lider' as const, mode: 'nuvem' as const, model: 'claude-sonnet-5', endpoint: 'anthropic' };
const providers = (esc = ESC) => ({ lider: LIDER, worker: LOCAL, esc });
const okOllama = createOllamaSupervisor({ fetch: (async () => new Response(JSON.stringify({ models: [{ name: 'qwen3.5:27b' }] }))) as never });
const tools = () => ({ android_conta1_get_screen_state: screenTool(() => SCREEN), android_conta1_tap_node: tapTool });

describe('runTask — incremento 2: provedor, piso e escalonamento', () => {
  it('piso em 3 inválidas → segundo generateText com o modelo de esc, histórico + nota, orçamento restante; task degraded', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const worker = new MockLanguageModelV4({ doGenerate: [calls({ id: 'c0', name: 'android_conta1_get_screen_state', input: {} }), invalid('c1'), invalid('c2'), invalid('c3'), text('nunca')] as never });
    const esc = new MockLanguageModelV4({ doGenerate: [text('resumo do escalonamento')] as never });
    const r = await runTask({ ...opts(db), providers: providers(), stepBudget: 10 }, { connect: mkMcp(tools()), model: worker, escModel: esc, ollama: okOllama });
    expect(r.outcome).toBe('done'); expect(r.summary).toBe('resumo do escalonamento');
    expect(r.degraded).toBe(true); expect(r.escalatedAtStep).toBe(4); expect(r.invalidCalls).toBe(3);
    expect(worker.doGenerateCalls).toHaveLength(4); expect(esc.doGenerateCalls).toHaveLength(1);
    const seen = esc.doGenerateCalls[0].prompt.map((m) => m.role);
    expect(seen[0]).toBe('system'); expect(seen).toContain('tool'); expect(seen[seen.length - 1]).toBe('user');
    const lastUser = esc.doGenerateCalls[0].prompt[esc.doGenerateCalls[0].prompt.length - 1] as { content: { text?: string }[] };
    expect(JSON.stringify(lastUser.content)).toMatch(/3 vez|falhou/);
    const t = db.prepare('select degraded, escalated_at_step, state from task where id=?').get(r.taskId) as { degraded: number; escalated_at_step: number; state: string };
    expect(t).toEqual({ degraded: 1, escalated_at_step: 4, state: 'done' });
    const provs = db.prepare('select provider, invalid_call from step where task_id=? order by idx').all(r.taskId) as { provider: string; invalid_call: number }[];
    expect(provs.map((p) => p.provider)).toEqual(['local:qwen3.5:27b', 'local:qwen3.5:27b', 'local:qwen3.5:27b', 'local:qwen3.5:27b', 'nuvem:claude-haiku-4-5']);
    expect(provs.filter((p) => p.invalid_call === 1)).toHaveLength(3);
  });
  it('Ollama recusa a chamada do modelo ("error parsing tool call") → escala para o esc em vez de falhar a tarefa', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const parse = Object.assign(new Error("error parsing tool call: raw='We need open the post…'"), { name: 'AI_APICallError', isRetryable: false });
    const worker = new MockLanguageModelV4({ doGenerate: async () => { throw parse; } });
    const esc = new MockLanguageModelV4({ doGenerate: [text('resumo do escalonamento')] as never });
    const r = await runTask({ ...opts(db), providers: providers(), stepBudget: 10 }, { connect: mkMcp(tools()), model: worker, escModel: esc, ollama: okOllama });
    expect(r.outcome).toBe('done'); expect(r.summary).toBe('resumo do escalonamento');
    expect(r.degraded).toBe(true); expect(esc.doGenerateCalls).toHaveLength(1);
    const lastUser = esc.doGenerateCalls[0].prompt[esc.doGenerateCalls[0].prompt.length - 1] as { content: { text?: string }[] };
    expect(JSON.stringify(lastUser.content)).toMatch(/falhou/);
  });
  it('mesma recusa sem esc na nuvem → quality-floor (como as inválidas), não "failed" com o erro cru', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const parse = Object.assign(new Error("error parsing tool call: raw='x'"), { name: 'AI_APICallError', isRetryable: false });
    const worker = new MockLanguageModelV4({ doGenerate: async () => { throw parse; } });
    const r = await runTask({ ...opts(db), providers: providers({ ...ESC, mode: 'local', endpoint: LOCAL.endpoint }) }, { connect: mkMcp(tools()), model: worker, ollama: okOllama });
    expect(r.outcome).toBe('quality-floor');
  });
  it('sem esc na nuvem (esc local) → outcome quality-floor, task failed, identidade idle, sem segundo modelo', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const worker = new MockLanguageModelV4({ doGenerate: [invalid('c1'), invalid('c2'), invalid('c3'), text('nunca')] as never });
    const esc = new MockLanguageModelV4({ doGenerate: [text('não')] as never });
    const r = await runTask({ ...opts(db), providers: providers({ ...ESC, mode: 'local', endpoint: LOCAL.endpoint }) }, { connect: mkMcp(tools()), model: worker, escModel: esc, ollama: okOllama });
    expect(r.outcome).toBe('quality-floor'); expect(esc.doGenerateCalls).toHaveLength(0);
    expect(taskState(db, r.taskId)).toBe('failed'); expect(getIdentity(db, 'conta1')?.state).toBe('idle');
  });
  it('Ollama que não sobe → outcome infra (infra-local), task todo, identidade idle, modelo nunca chamado', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const worker = new MockLanguageModelV4({ doGenerate: [text('x')] as never });
    const dead = createOllamaSupervisor({ fetch: (async () => { throw new Error('ECONNREFUSED'); }) as never, sleep: async () => {}, timeoutMs: 1, logPath: '/dev/null', openLog: () => 'x', spawn: () => ({ pid: 1, kill: () => true, on: () => undefined }) });
    const r = await runTask({ ...opts(db), providers: providers() }, { connect: mkMcp(tools()), model: worker, ollama: dead });
    expect(r.outcome).toBe('infra'); expect(worker.doGenerateCalls).toHaveLength(0);
    expect(taskState(db, r.taskId)).toBe('todo'); expect(getIdentity(db, 'conta1')?.state).toBe('idle');
    expect(getIdentity(db, 'conta1')?.lastError).toMatch(/Ollama/);
  });
  it('kill switch durante o segmento 2 → killed com degraded preservado (Review Focus 3)', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    let killed = false;
    const worker = new MockLanguageModelV4({ doGenerate: [invalid('c1'), invalid('c2'), invalid('c3')] as never });
    const esc = new MockLanguageModelV4({ doGenerate: [
      { ...calls({ id: 'e1', name: 'android_conta1_get_screen_state', input: {} }) }, text('não chega'),
    ] as never });
    const r = await runTask({ ...opts(db), providers: providers(), isKilled: () => killed, onStep: () => { if (esc.doGenerateCalls.length > 0) killed = true; } }, { connect: mkMcp(tools()), model: worker, escModel: esc, ollama: okOllama });
    expect(r.outcome).toBe('killed'); expect(r.degraded).toBe(true);
    expect((db.prepare('select degraded from task where id=?').get(r.taskId) as { degraded: number }).degraded).toBe(1);
  });
  it('nuvem: providerOptions do anthropic continuam; local: providerOptions vazio e sem cacheControl', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const local = new MockLanguageModelV4({ doGenerate: [text('fim')] as never });
    await runTask({ ...opts(db), providers: providers() }, { connect: mkMcp(tools()), model: local, ollama: okOllama });
    expect(local.doGenerateCalls[0].providerOptions ?? {}).toEqual({});
    const cloud = new MockLanguageModelV4({ doGenerate: [text('fim')] as never });
    await runTask({ ...opts(db), providers: { ...providers(), worker: { ...ESC, role: 'worker' } } }, { connect: mkMcp(tools()), model: cloud });
    expect((cloud.doGenerateCalls[0].providerOptions as { anthropic: { cacheControl: unknown } }).anthropic.cacheControl).toEqual({ type: 'ephemeral', ttl: '1h' });
  });
  it('gen_ms vem do onLanguageModelCallEnd (performance.responseTimeMs) e o total sai em result.genMs', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const m = new MockLanguageModelV4({ doGenerate: [calls({ id: 'c0', name: 'android_conta1_get_screen_state', input: {} }), text('fim')] as never });
    const r = await runTask({ ...opts(db), providers: providers() }, { connect: mkMcp(tools()), model: m, ollama: okOllama });
    const g = db.prepare('select gen_ms from step where task_id=?').all(r.taskId) as { gen_ms: number | null }[];
    expect(g.every((x) => typeof x.gen_ms === 'number' && x.gen_ms >= 0)).toBe(true);
    expect(r.genMs).toBeGreaterThanOrEqual(0); expect(r.provider).toBe('local:qwen3.5:27b');
  });
});

describe('runTask — revisão final do incremento 2', () => {
  it('Important 6: erro de API do Ollama no meio da tarefa → infra-local (task todo, identidade idle)', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const boom = Object.assign(new Error('Cannot connect to API: fetch failed ECONNREFUSED 127.0.0.1:11434'), { name: 'AI_APICallError' });
    const generate = (async () => { throw boom; }) as never;
    const r = await runTask({ ...opts(db), providers: providers() }, { connect: mkMcp(tools()), model: new MockLanguageModelV4({ doGenerate: [] as never }), ollama: okOllama, generate });
    expect(r.outcome).toBe('infra'); expect(taskState(db, r.taskId)).toBe('todo'); expect(getIdentity(db, 'conta1')?.state).toBe('idle');
    expect(getIdentity(db, 'conta1')?.lastError).toMatch(/ECONNREFUSED/);
  });
  it('Important 6b: o mesmo erro vindo do provedor de nuvem continua sendo failed (não é infra-local)', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const boom = Object.assign(new Error('fetch failed'), { name: 'AI_APICallError' });
    const r = await runTask({ ...opts(db) }, { connect: mkMcp(tools()), model: new MockLanguageModelV4({ doGenerate: [] as never }), generate: (async () => { throw boom; }) as never });
    expect(r.outcome).toBe('failed'); expect(taskState(db, r.taskId)).toBe('failed');
  });
});

describe('runTask — incremento 3', () => {
  it('parada precoce: done com orçamento sobrando grava early_stop_remaining e sai no resultado', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const m = new MockLanguageModelV4({ doGenerate: [text('nada a fazer')] as never });
    const r = await runTask({ ...opts(db), providers: providers(), stepBudget: 10 }, { connect: mkMcp(tools()), model: m, ollama: okOllama });
    expect(r.outcome).toBe('done'); expect(r.earlyStopRemaining).toBe(9);
    expect((db.prepare('select early_stop_remaining as e from task where id=?').get(r.taskId) as { e: number }).e).toBe(9);
  });
  it('piso no último passo do orçamento → sem segmento 2, outcome budget, degraded 0 (Review Focus 5)', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const worker = new MockLanguageModelV4({ doGenerate: [invalid('c1'), invalid('c2'), invalid('c3')] as never });
    const esc = new MockLanguageModelV4({ doGenerate: [text('não')] as never });
    const r = await runTask({ ...opts(db), providers: providers(), stepBudget: 3 }, { connect: mkMcp(tools()), model: worker, escModel: esc, ollama: okOllama });
    expect(r.outcome).toBe('budget'); expect(r.degraded).toBe(false); expect(esc.doGenerateCalls).toHaveLength(0); expect(r.earlyStopRemaining).toBe(0);
  });
  it('ProviderError auth (sem chave, worker na nuvem) → failed, identidade idle, lastError cita a chave', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const r = await runTask({ ...opts(db), apiKey: '' }, { connect: mkMcp(tools()) });
    expect(r.outcome).toBe('failed'); expect(taskState(db, r.taskId)).toBe('failed');
    expect(getIdentity(db, 'conta1')?.state).toBe('idle'); expect(getIdentity(db, 'conta1')?.lastError).toMatch(/ANTHROPIC_API_KEY/);
  });
  it('orçamento desligável (stepBudget: null): sem stepCountIs, roda os 40 passos até o fim, outcome done (não budget)', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const N = 40;
    const steps = [...Array.from({ length: N }, (_, i) => calls({ id: `c${i}`, name: 'android_conta1_get_screen_state', input: {} })), text('fim')];
    const m = new MockLanguageModelV4({ doGenerate: steps as never });
    const r = await runTask({ ...opts(db), providers: providers(), stepBudget: null }, { connect: mkMcp(tools()), model: m, ollama: okOllama });
    expect(r.outcome).toBe('done');
    expect(m.doGenerateCalls).toHaveLength(N + 1);
    expect(r.earlyStopRemaining).toBe(0);
  });
});

describe('click_node em nó não clicável (integrador)', () => {
  const clickTool = (fail: string | null) => tool({ description: 'click', inputSchema: z.object({ node_id: z.string() }), execute: async () => { if (fail) throw new Error(`Error executing tool android_conta1_click_node: ${fail}`); return 'Click performed'; } });
  it('"is not clickable" cai para tap_node no mesmo nó e o modelo recebe o toque', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row); const tapped: unknown[] = [];
    const tap = tool({ description: 'tap', inputSchema: z.object({ node_id: z.string() }), execute: async (i) => { tapped.push(i); return 'Tap executed at (5, 5) within node \'node_ok\''; } });
    const model = new MockLanguageModelV4({ doGenerate: [
      calls({ id: 'c1', name: 'android_conta1_get_screen_state', input: {} }),
      calls({ id: 'c2', name: 'android_conta1_click_node', input: { node_id: 'node_ok' } }),
      text('fim'),
    ] as never });
    const r = await runTask(opts(db), { connect: mkMcp({ android_conta1_get_screen_state: screenTool(() => SCREEN), android_conta1_click_node: clickTool("Node 'node_ok' is not clickable"), android_conta1_tap_node: tap }), model });
    expect(r.outcome).toBe('done');
    expect(tapped).toEqual([{ node_id: 'node_ok' }]);
    const click = stepsOf(db, r.taskId).find((s) => s.tool === 'android_conta1_click_node');
    expect(click?.error).toBeNull();
    expect(click?.result_excerpt).toMatch(/Tap executed/);
    expect(JSON.stringify(model.doGenerateCalls[2].prompt)).toMatch(/não é clicável.*tap_node/);
  });
  it('outros erros de click_node seguem para o modelo como antes (sem toque)', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row); let taps = 0;
    const tap = tool({ description: 'tap', inputSchema: z.object({ node_id: z.string() }), execute: async () => { taps += 1; return 'Tap'; } });
    const model = new MockLanguageModelV4({ doGenerate: [
      calls({ id: 'c1', name: 'android_conta1_get_screen_state', input: {} }),
      calls({ id: 'c2', name: 'android_conta1_click_node', input: { node_id: 'node_ok' } }),
      text('fim'),
    ] as never });
    const r = await runTask(opts(db), { connect: mkMcp({ android_conta1_get_screen_state: screenTool(() => SCREEN), android_conta1_click_node: clickTool("Node 'node_ok' not found in accessibility tree"), android_conta1_tap_node: tap }), model });
    expect(taps).toBe(0);
    expect(stepsOf(db, r.taskId).find((s) => s.tool === 'android_conta1_click_node')?.error).toMatch(/not found/);
  });
});

describe('sessão perdida (integrador)', () => {
  it('tela de login do Instagram para a tarefa e deixa a identidade em needs-human com o motivo', async () => {
    const LOGIN = 'screen:1080x2400 density:420 orientation:portrait\n--- window:1 type:APPLICATION pkg:com.instagram.android title:Instagram layer:0 focused:true ---\nnode_id\tclass\ttext\tdesc\tres_id\tbounds\tflags\n'
      + 'node_u\tEditText\t-\tUsername, email or mobile number,\t-\t0,0,10,10\ton,clk,edt,ena\nnode_p\tEditText\t-\tPassword,\t-\t0,20,10,30\ton,clk,edt,ena\nnode_l\tButton\t-\tLog in\t-\t0,40,10,50\ton,clk,ena\n';
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const model = new MockLanguageModelV4({ doGenerate: [calls({ id: 'c1', name: 'android_conta1_get_screen_state', input: {} }), text('0 itens')] as never });
    const r = await runTask(opts(db), { connect: mkMcp({ android_conta1_get_screen_state: screenTool(() => LOGIN) }), model });
    expect(r.outcome).toBe('platform-block');
    expect(taskState(db, r.taskId)).toBe('needs-human');
    expect(getIdentity(db, 'conta1')).toMatchObject({ state: 'needs-human', lastError: expect.stringMatching(/deslogado/) });
  });
});
