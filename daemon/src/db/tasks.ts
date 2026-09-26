import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export function createGoalAndTask(db: DatabaseSync, identityId: string, text: string): { goalId: string; taskId: string } {
  const goalId = randomUUID(); const taskId = randomUUID();
  db.prepare("insert into goal (id, text, pattern, state) values (?, ?, 'fan-out', 'running')").run(goalId, text);
  db.prepare("insert into task (id, goal_id, identity_id, instruction, state, attempts) values (?, ?, ?, ?, 'running', 1)").run(taskId, goalId, identityId, text);
  return { goalId, taskId };
}

export function setTaskState(db: DatabaseSync, taskId: string, state: 'todo' | 'running' | 'done' | 'failed' | 'needs-human'): void {
  db.prepare("update task set state=?, finished_at=case when ? in ('done','failed','needs-human') then datetime('now') else finished_at end where id=?").run(state, state, taskId);
}

/** Intenção write-ahead: a linha existe ANTES da tool rodar (spec §4.3, recuperação de crash). */
export function writeIntent(db: DatabaseSync, taskId: string, tool: string, args: unknown, idempotencyKey: string): number {
  // idx é a ordem cronológica por tarefa — calculado aqui para que executadas, negadas e alucinadas compartilhem a mesma sequência.
  const r = db.prepare("insert into step (task_id, idx, tool, args_json, idempotency_key, intent_written_at, started_at) values (?, (select coalesce(max(idx), 0) + 1 from step where task_id = ?), ?, ?, ?, datetime('now'), datetime('now'))")
    .run(taskId, taskId, tool, JSON.stringify(args ?? null), idempotencyKey);
  return Number(r.lastInsertRowid);
}

export function finishStep(db: DatabaseSync, stepId: number, p: { resultExcerpt?: string; latencyMs?: number; error?: string; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number }): void {
  db.prepare(`update step set result_excerpt=coalesce(?, result_excerpt), latency_ms=coalesce(?, latency_ms), error=coalesce(?, error),
    input_tokens=coalesce(?, input_tokens), output_tokens=coalesce(?, output_tokens), cache_read_tokens=coalesce(?, cache_read_tokens), finished_at=datetime('now') where id=?`)
    .run(p.resultExcerpt ?? null, p.latencyMs ?? null, p.error ?? null, p.inputTokens ?? null, p.outputTokens ?? null, p.cacheReadTokens ?? null, stepId);
}

export function addTaskCost(db: DatabaseSync, taskId: string, usd: number): void {
  db.prepare('update task set cost_usd = cost_usd + ? where id=?').run(usd, taskId);
  db.prepare('update goal set cost_usd = cost_usd + ? where id = (select goal_id from task where id=?)').run(usd, taskId);
}

export function ledgerHas(db: DatabaseSync, identityId: string, key: string): boolean {
  return !!db.prepare('select 1 from ledger where identity_id=? and item_key=?').get(identityId, key);
}
export function ledgerPut(db: DatabaseSync, identityId: string, key: string, kind: string, note: string): void {
  db.prepare('insert or ignore into ledger (identity_id, item_key, kind, note) values (?, ?, ?, ?)').run(identityId, key, kind, note);
}
