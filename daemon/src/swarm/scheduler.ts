import type { DatabaseSync } from 'node:sqlite';
import { CONFIG } from '../config.js';
import { getIdentity, type IdentityRow } from '../db/identities.js';
import { createGoal, createTask, finishGoal, finishStep, setTaskState, writeIntent, type GoalState } from '../db/tasks.js';
import { humanBlockLabel, readinessOf, type EnsureReady } from '../leader/readiness.js';
import type { GoalPlan, PlanTask } from '../leader/types.js';

/** O que o scheduler entrega a um worker: a identidade relida do banco, o objetivo, a tarefa e a fatia dela. */
export interface WorkerJob {
  readonly identity: IdentityRow; readonly goalId: string; readonly taskId: string; readonly instruction: string; readonly goalText: string;
}
export interface SchedulerDeps {
  readonly db: DatabaseSync;
  readonly isKilled: () => boolean;
  /** Roda o worker da identidade até o fim (produção: `runTask`). Deve deixar a tarefa num estado final. */
  readonly runWorker: (job: WorkerJob) => Promise<unknown>;
  /** Re-sonda cada identidade na hora do start (plano pode ter vindo do cliente, ou envelhecido no escalonamento). */
  readonly ensureReady?: EnsureReady;
  readonly staggerMs?: number; readonly jitterMs?: number;
  readonly sleep?: (ms: number) => Promise<void>; readonly random?: () => number;
  /** Mudança de estado (tarefa começou, pulou, terminou; objetivo fechou): o daemon faz broadcast do snapshot. */
  readonly onChange?: () => void;
}
export interface StartedGoal { readonly goalId: string; readonly done: Promise<GoalState> }

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
interface Slot { readonly task: PlanTask; readonly taskId: string }

/**
 * Pulada no start: a tarefa vira 'failed' (não 'todo', que deixaria o objetivo aberto para sempre) e o motivo
 * vai para o log de passos da identidade como `pulada: <motivo>`, visível no cockpit.
 */
function skip(db: DatabaseSync, taskId: string, reason: string): void {
  const stepId = writeIntent(db, taskId, '(scheduler)', null, `${taskId}:skip`);
  finishStep(db, stepId, { resultExcerpt: `pulada: ${reason}`.slice(0, 300) });
  setTaskState(db, taskId, 'failed');
}

/** Motivo para não começar agora, relido do banco (kill switch, humano no comando, needs-human, banida) e da sonda. */
async function blockReason(d: SchedulerDeps, identityId: string): Promise<{ reason: string } | { identity: IdentityRow }> {
  if (d.isKilled()) return { reason: 'kill switch' };
  const id = getIdentity(d.db, identityId);
  if (!id) return { reason: 'identidade removida' };
  const blocked = humanBlockLabel(id);
  if (blocked) return { reason: blocked };
  if (d.ensureReady) {
    const r = await readinessOf(d.db, id, d.ensureReady);
    if (!r.ready) return { reason: r.readyLabel };
    if (d.isKilled()) return { reason: 'kill switch' };
  }
  const fresh = getIdentity(d.db, identityId);
  return fresh ? { identity: fresh } : { reason: 'identidade removida' };
}

async function runSlot(d: SchedulerDeps, goalId: string, goalText: string, slot: Slot, delayMs: number): Promise<void> {
  await (d.sleep ?? defaultSleep)(delayMs);
  const b = await blockReason(d, slot.task.identityId);
  if ('reason' in b) { skip(d.db, slot.taskId, b.reason); d.onChange?.(); return; }
  try {
    await d.runWorker({ identity: b.identity, goalId, taskId: slot.taskId, instruction: slot.task.instruction, goalText });
  } catch (e) {
    console.error(`[scheduler] worker de ${slot.task.identityId} falhou:`, e);
    const st = (d.db.prepare('select state from task where id=?').get(slot.taskId) as { state: string } | undefined)?.state;
    if (st === 'todo' || st === 'running') setTaskState(d.db, slot.taskId, 'failed');
  }
  d.onChange?.();
}

/** PlanTasks prontas, uma por identidade (a primeira vence) e só de identidades que existem (FK de task). */
function readyTasks(db: DatabaseSync, tasks: readonly PlanTask[]): readonly PlanTask[] {
  const byId = new Map<string, PlanTask>();
  for (const t of tasks) if (t.ready && !byId.has(t.identityId) && getIdentity(db, t.identityId)) byId.set(t.identityId, t);
  return [...byId.values()];
}

/**
 * Cria o objetivo e uma tarefa 'todo' por PlanTask pronta (identidade existente, sem repetir) e dispara os workers:
 * identidade i começa após i × staggerMs + jitter em [0, jitterMs). Falha de uma não bloqueia as outras (spec §6).
 * Devolve o goalId na hora; `done` resolve com o estado final gravado.
 */
export function startGoal(plan: GoalPlan, d: SchedulerDeps): StartedGoal {
  const goalId = createGoal(d.db, { text: plan.text, pattern: plan.pattern, rationale: plan.rationale, planJson: JSON.stringify(plan) });
  const ready = readyTasks(d.db, plan.tasks);
  const slots: readonly Slot[] = ready.map((task) => ({ task, taskId: createTask(d.db, goalId, task.identityId, task.instruction) }));
  const stagger = d.staggerMs ?? CONFIG.swarm.staggerMs; const jitter = d.jitterMs ?? CONFIG.swarm.jitterMs;
  const random = d.random ?? Math.random;
  const runs = slots.map((s, i) => runSlot(d, goalId, plan.text, s, i * stagger + Math.floor(random() * jitter)));
  const done = Promise.allSettled(runs).then(() => { const st = finishGoal(d.db, goalId); d.onChange?.(); return st; });
  return { goalId, done };
}

export async function runGoal(plan: GoalPlan, d: SchedulerDeps): Promise<{ goalId: string; state: GoalState }> {
  const s = startGoal(plan, d);
  return { goalId: s.goalId, state: await s.done };
}
