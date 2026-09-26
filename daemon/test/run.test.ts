import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { getIdentity, upsertIdentity } from '../src/db/identities.js';
import { runTask, type RunTaskDeps } from '../src/worker/run.js';

const row = { id: 'conta1', name: 'conta1', handle: '@a', avdName: 'x', serial: 's', consolePort: 5554, mcpHostPort: 8080, mcpToken: 't', deviceSlug: 'conta1', appPackage: 'com.instagram.android', appVersionName: '1', state: 'idle' as const };
const CK = 'screen:1080x2400 density:420 orientation:portrait\n--- window:1 type:APPLICATION pkg:com.instagram.android title:Instagram layer:0 focused:true ---\nnode_id\tclass\ttext\tdesc\tres_id\tbounds\tflags\nnode_a1\tTextView\tConfirme que é você\t-\t-\t0,0,10,10\ton,ena\n';

/** generateText falso: chama a tool de tela uma vez e devolve texto. Suficiente para testar o que é nosso. */
const fakeGenerate = (): RunTaskDeps['generate'] => (async (opts: { tools: Record<string, { execute: (i: unknown, o: unknown) => Promise<unknown> }>; onStepFinish?: (s: unknown) => void | Promise<void> }) => {
  const tool = opts.tools['android_conta1_get_screen_state'];
  const out = await tool.execute({}, { toolCallId: 'x', messages: [] });
  await opts.onStepFinish?.({ stepNumber: 0, text: '', toolCalls: [{ toolCallId: 'x', toolName: 'android_conta1_get_screen_state', input: {} }], toolResults: [{ toolCallId: 'x', toolName: 'android_conta1_get_screen_state', output: { type: 'text', value: String(out) } }], usage: { inputTokens: 100, outputTokens: 10 } });
  return { text: 'resumo', totalUsage: { inputTokens: 100, outputTokens: 10 }, steps: [] };
}) as unknown as RunTaskDeps['generate'];
const fakeMcp = (screenText: string, fail?: 'unauthorized' | 'device-missing'): RunTaskDeps['connect'] => async () => ({
  tools: async () => ({
    android_conta1_get_screen_state: { description: 'x', inputSchema: {}, execute: async () => { if (fail === 'unauthorized') throw new Error('HTTP 401 Unauthorized'); if (fail === 'device-missing') throw new Error("adb: device 'emulator-5554' not found"); return screenText; } },
    android_conta1_click_node: { description: 'x', inputSchema: {}, execute: async () => 'ok' },
  }) as never,
  close: async () => {},
});
const base = (db: ReturnType<typeof openDb>) => ({ db, identity: row, goalText: 'g', apiKey: 'k', isKilled: () => false, onStep: () => {} });

describe('runTask', () => {
  it('checkpoint na tela → platform-block, identidade needs-human, loop encerra', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const r = await runTask(base(db), { connect: fakeMcp(CK), generate: fakeGenerate() });
    expect(r.outcome).toBe('platform-block'); expect(r.platformBlock).toMatch(/Confirme/);
    expect(getIdentity(db, 'conta1')?.state).toBe('needs-human');
  });
  it('401 do MCP → infra, identidade offline, sem retry', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const r = await runTask(base(db), { connect: fakeMcp('', 'unauthorized'), generate: fakeGenerate() });
    expect(r.outcome).toBe('infra'); expect(getIdentity(db, 'conta1')?.state).toBe('offline');
    expect((db.prepare('select count(*) as n from step').get() as { n: number }).n).toBeLessThanOrEqual(1);
  });
  it('device sumiu → infra e tarefa volta para todo', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const r = await runTask(base(db), { connect: fakeMcp('', 'device-missing'), generate: fakeGenerate() });
    expect(r.outcome).toBe('infra');
    expect((db.prepare('select state from task where id=?').get(r.taskId) as { state: string }).state).toBe('todo');
  });
  it('tela normal → done, identidade idle, passo gravado com tokens', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const normal = 'screen:1080x2400 density:420 orientation:portrait\n--- window:1 type:APPLICATION pkg:com.instagram.android title:Instagram layer:0 focused:true ---\nnode_id\tclass\ttext\tdesc\tres_id\tbounds\tflags\nnode_b1\tTextView\tFeed\t-\t-\t0,0,10,10\ton,ena\n';
    const r = await runTask(base(db), { connect: fakeMcp(normal), generate: fakeGenerate() });
    expect(r.outcome).toBe('done'); expect(getIdentity(db, 'conta1')?.state).toBe('idle');
    expect((db.prepare('select input_tokens from step').get() as { input_tokens: number }).input_tokens).toBe(100);
  });
});
