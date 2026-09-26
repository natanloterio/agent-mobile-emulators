import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { upsertIdentity } from '../src/db/identities.js';
import { createGoalAndTask, finishStep, ledgerHas, ledgerPut, writeIntent } from '../src/db/tasks.js';
import { readUsage, recordStep } from '../src/worker/record.js';

const row = { id: 'conta1', name: 'conta1', handle: '@a', avdName: 'x', serial: 's', consolePort: 5554, mcpHostPort: 8080, mcpToken: 't', deviceSlug: 'conta1', appPackage: 'p', appVersionName: '1', state: 'idle' as const };
const PRICING = { inputPerM: 1, outputPerM: 5, cacheReadPerM: 0.1 };

describe('write-ahead e ledger', () => {
  it('writeIntent grava antes; finishStep completa; idempotency_key é único por (tarefa, chave)', () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const { taskId } = createGoalAndTask(db, 'conta1', 'objetivo');
    const id = writeIntent(db, taskId, 1, 'android_conta1_click_node', { node_id: 'n1' }, 'conta1:click:n1');
    const pending = db.prepare('select finished_at, intent_written_at from step where id=?').get(id) as { finished_at: string | null; intent_written_at: string };
    expect(pending.finished_at).toBeNull(); expect(pending.intent_written_at).toBeTruthy();
    finishStep(db, id, { resultExcerpt: 'Click performed', latencyMs: 120 });
    expect((db.prepare('select finished_at from step where id=?').get(id) as { finished_at: string }).finished_at).toBeTruthy();
  });
  it('ledger: put é idempotente e has responde', () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    expect(ledgerHas(db, 'conta1', 'comment:jufs:abc')).toBe(false);
    ledgerPut(db, 'conta1', 'comment:jufs:abc', 'comment', 'rascunho: obrigada!');
    ledgerPut(db, 'conta1', 'comment:jufs:abc', 'comment', 'de novo');
    expect(ledgerHas(db, 'conta1', 'comment:jufs:abc')).toBe(true);
    expect((db.prepare('select count(*) as n from ledger').get() as { n: number }).n).toBe(1);
  });
});

describe('recordStep', () => {
  it('grava tokens por passo, soma custo na tarefa e marca GATE quando negado', () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const { taskId } = createGoalAndTask(db, 'conta1', 'objetivo');
    const step = {
      stepNumber: 0, text: '',
      toolCalls: [{ toolCallId: 'c1', toolName: 'android_conta1_tap_node', input: { node_id: 'n9' } }],
      toolResults: [{ toolCallId: 'c1', toolName: 'android_conta1_tap_node', output: { type: 'execution-denied', reason: 'GATE: irreversível' } }],
      usage: { inputTokens: 6000, outputTokens: 80, inputTokenDetails: { cacheReadTokens: 5000 } },
    };
    const { costUsd } = recordStep(db, taskId, step, PRICING);
    expect(costUsd).toBeCloseTo((1000 * 1 + 5000 * 0.1 + 80 * 5) / 1_000_000, 8);
    const s = db.prepare('select tool, result_excerpt, input_tokens, cache_read_tokens from step where task_id=?').get(taskId) as Record<string, unknown>;
    expect(s.tool).toBe('android_conta1_tap_node'); expect(String(s.result_excerpt)).toMatch(/^GATE/); expect(s.cache_read_tokens).toBe(5000);
    expect((db.prepare('select cost_usd from task where id=?').get(taskId) as { cost_usd: number }).cost_usd).toBeCloseTo(costUsd, 8);
  });
  it('readUsage tolera campos ausentes', () => {
    expect(readUsage({})).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 });
  });
  it('tool alucinada / erro de execução vira linha com error e excerpt ERRO, sem lançar', () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const { taskId } = createGoalAndTask(db, 'conta1', 'objetivo');
    const step = {
      stepNumber: 1, text: '',
      toolCalls: [{ toolCallId: 'c2', toolName: 'android_conta1_launch_app', input: {} }],
      toolResults: [{ toolCallId: 'c2', toolName: 'android_conta1_launch_app', output: { type: 'error-text', value: 'NoSuchToolError: android_conta1_launch_app' } }],
      usage: { inputTokens: 10, outputTokens: 2 },
    };
    expect(() => recordStep(db, taskId, step, PRICING)).not.toThrow();
    const s = db.prepare('select result_excerpt, error from step where task_id=?').get(taskId) as { result_excerpt: string; error: string | null };
    expect(s.result_excerpt).toMatch(/^ERRO/); expect(s.error).toMatch(/NoSuchToolError/);
  });
});
