import type { DatabaseSync } from 'node:sqlite';
import { markInterrupted } from '../db/missions.js';
import { finishGoal } from '../db/tasks.js';

const INTERRUPTED = 'daemon reiniciou no meio da ação: verificar o estado real no device antes de repetir';

/**
 * Subida do daemon (spec §4.3, recuperação de crash): nada que estava em voo é retomado sozinho.
 * Tarefas `running`/`todo` viram `failed`; passos com intenção sem conclusão ganham o aviso de verificação; identidades
 * `running` voltam a `idle`; objetivos `running` fecham pelo estado das tarefas. Idempotente.
 * Missões (spec missões): a subtarefa em voo vira `interrupted` e a missão fica aberta — o runner a retoma depois.
 */
export function reconcileOnStart(db: DatabaseSync): { tasks: number; steps: number; identities: number; goals: number; subtasks: number } {
  const steps = db.prepare("update step set error=coalesce(error, ?), finished_at=datetime('now') where finished_at is null and task_id in (select id from task where state in ('running','todo'))").run(INTERRUPTED).changes;
  const subtasks = markInterrupted(db);
  const tasks = db.prepare("update task set state='failed', finished_at=datetime('now') where state in ('running','todo')").run().changes;
  const identities = db.prepare("update identity set state='idle', updated_at=datetime('now') where state='running'").run().changes;
  const open = db.prepare("select id from goal where state='running' and pattern != 'mission'").all() as { id: string }[];
  for (const g of open) finishGoal(db, g.id);
  return { tasks: Number(tasks), steps: Number(steps), identities: Number(identities), goals: open.length, subtasks };
}
