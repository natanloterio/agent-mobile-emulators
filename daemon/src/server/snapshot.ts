import type { DatabaseSync } from 'node:sqlite';
import { listIdentities } from '../db/identities.js';

export interface ToolRow { readonly idx: number; readonly tool: string; readonly excerpt: string; readonly tokens: number; readonly gate: boolean }
export interface IdentitySnapshot {
  readonly id: string; readonly name: string; readonly handle: string; readonly state: string; readonly task: string;
  readonly steps: number; readonly budget: number; readonly costUsd: number; readonly error: string; readonly lastTools: readonly ToolRow[];
}
export interface FleetSnapshot { readonly identities: readonly IdentitySnapshot[]; readonly killed: boolean; readonly updatedAt: string }

const BUDGET = 30;

export function buildSnapshot(db: DatabaseSync, killed: boolean): FleetSnapshot {
  const identities = listIdentities(db).map((id) => {
    const task = db.prepare("select id, instruction, state, cost_usd from task where identity_id=? order by created_at desc limit 1").get(id.id) as
      { id: string; instruction: string; state: string; cost_usd: number } | undefined;
    const steps = task ? (db.prepare('select count(*) as n from step where task_id=?').get(task.id) as { n: number }).n : 0;
    const lastTools = task ? (db.prepare('select idx, tool, result_excerpt, input_tokens, output_tokens, args_json from step where task_id=? order by idx desc limit 6').all(task.id) as
      { idx: number; tool: string | null; result_excerpt: string | null; input_tokens: number | null; output_tokens: number | null; args_json: string | null }[])
      .map((s) => ({ idx: s.idx, tool: s.tool ?? '—', excerpt: s.result_excerpt ?? '', tokens: (s.input_tokens ?? 0) + (s.output_tokens ?? 0), gate: (s.result_excerpt ?? '').startsWith('GATE') })) : [];
    return {
      id: id.id, name: id.name, handle: id.handle, state: id.state, task: task?.instruction ?? 'Aguardando',
      steps, budget: BUDGET, costUsd: task?.cost_usd ?? 0, error: id.lastError ?? '', lastTools,
    };
  });
  return { identities, killed, updatedAt: new Date().toISOString() };
}
