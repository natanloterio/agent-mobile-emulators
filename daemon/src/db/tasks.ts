import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export function createGoalAndTask(db: DatabaseSync, identityId: string, text: string): { goalId: string; taskId: string } {
  const goalId = randomUUID(); const taskId = randomUUID();
  db.prepare("insert into goal (id, text, pattern, state) values (?, ?, 'fan-out', 'running')").run(goalId, text);
  db.prepare("insert into task (id, goal_id, identity_id, instruction, state, attempts) values (?, ?, ?, ?, 'running', 1)").run(taskId, goalId, identityId, text);
  return { goalId, taskId };
}

export type GoalPattern = 'fan-out' | 'sharding';
export type GoalState = 'running' | 'done' | 'partial' | 'failed';

/** Objetivo do scheduler (spec inc. 5 §3.3): padrão, justificativa e o plano inteiro em JSON. */
export function createGoal(db: DatabaseSync, g: { text: string; pattern: GoalPattern; rationale: string; planJson: string }): string {
  const goalId = randomUUID();
  db.prepare("insert into goal (id, text, pattern, state, rationale, plan_json) values (?, ?, ?, 'running', ?, ?)").run(goalId, g.text, g.pattern, g.rationale, g.planJson);
  return goalId;
}

export function createTask(db: DatabaseSync, goalId: string, identityId: string, instruction: string, state: 'todo' | 'running' = 'todo'): string {
  const taskId = randomUUID();
  db.prepare('insert into task (id, goal_id, identity_id, instruction, state, attempts) values (?, ?, ?, ?, ?, ?)').run(taskId, goalId, identityId, instruction, state, state === 'running' ? 1 : 0);
  return taskId;
}

/** Tarefa criada pelo scheduler ('todo') começa: vira 'running' e conta a tentativa. */
export function startTask(db: DatabaseSync, taskId: string): void {
  db.prepare("update task set state='running', attempts=attempts+1 where id=?").run(taskId);
}

/** Estado final do objetivo pelas tarefas: todas done → done; alguma done → partial; senão failed. Grava finished_at. */
export function finishGoal(db: DatabaseSync, goalId: string): GoalState {
  const c = db.prepare("select count(*) as total, coalesce(sum(state='done'), 0) as done from task where goal_id=?").get(goalId) as { total: number; done: number };
  const state: GoalState = c.total > 0 && c.done === c.total ? 'done' : c.done > 0 ? 'partial' : 'failed';
  db.prepare("update goal set state=?, finished_at=datetime('now') where id=?").run(state, goalId);
  return state;
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

export interface FinishStepPatch {
  resultExcerpt?: string; latencyMs?: number; error?: string; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number;
  provider?: string; genMs?: number | null; invalidCall?: boolean;
}
export function finishStep(db: DatabaseSync, stepId: number, p: FinishStepPatch): void {
  db.prepare(`update step set result_excerpt=coalesce(?, result_excerpt), latency_ms=coalesce(?, latency_ms), error=coalesce(?, error),
    input_tokens=coalesce(?, input_tokens), output_tokens=coalesce(?, output_tokens), cache_read_tokens=coalesce(?, cache_read_tokens),
    provider=coalesce(?, provider), gen_ms=coalesce(?, gen_ms), invalid_call=case when ? then 1 else invalid_call end, finished_at=datetime('now') where id=?`)
    .run(p.resultExcerpt ?? null, p.latencyMs ?? null, p.error ?? null, p.inputTokens ?? null, p.outputTokens ?? null, p.cacheReadTokens ?? null,
      p.provider ?? null, p.genMs ?? null, p.invalidCall ? 1 : 0, stepId);
}

export function markDegraded(db: DatabaseSync, taskId: string, atStep: number): void {
  db.prepare('update task set degraded=1, escalated_at_step=? where id=?').run(atStep, taskId);
}

export function setEarlyStop(db: DatabaseSync, taskId: string, remaining: number): void {
  db.prepare('update task set early_stop_remaining=? where id=?').run(remaining, taskId);
}

export function addTaskCost(db: DatabaseSync, taskId: string, usd: number): void {
  db.prepare('update task set cost_usd = cost_usd + ? where id=?').run(usd, taskId);
  db.prepare('update goal set cost_usd = cost_usd + ? where id = (select goal_id from task where id=?)').run(usd, taskId);
}

export function ledgerHas(db: DatabaseSync, identityId: string, key: string): boolean {
  return !!db.prepare('select 1 from ledger where identity_id=? and item_key=?').get(identityId, key);
}
export function ledgerPut(db: DatabaseSync, identityId: string, key: string, kind: string, note: string, taskId: string | null = null): void {
  db.prepare('insert or ignore into ledger (identity_id, item_key, kind, note, task_id) values (?, ?, ?, ?, ?)').run(identityId, key, kind, note, taskId);
}
