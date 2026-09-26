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
