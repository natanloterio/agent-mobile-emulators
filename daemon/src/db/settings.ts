import type { DatabaseSync } from 'node:sqlite';
import { CONFIG } from '../config.js';

/** Limites de passos por tarefa/subtarefa, ajustáveis na tela (Provedores → Limites dos agentes) sem reiniciar. */
export interface StepBudgets { readonly goal: number | null; readonly mission: number | null }

const KEYS = { goal: 'stepBudget.goal', mission: 'stepBudget.mission' } as const;

/** JSON de uma linha (`30` ou `null`); ausente ou ilegível cai no `fallback` (default do CONFIG). */
function parseBudget(raw: string | undefined, fallback: number | null): number | null {
  if (raw === undefined) return fallback;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return fallback; }
  if (v === null) return null;
  return typeof v === 'number' && Number.isInteger(v) ? v : fallback;
}

/**
 * Lê os limites do banco (spec limites): sem linha, o default de `CONFIG.worker.stepBudget` /
 * `CONFIG.mission.subtaskStepBudget`; chamado no início de cada tarefa/subtarefa, nunca cacheado.
 */
export function readStepBudgets(db: DatabaseSync): StepBudgets {
  const rows = db.prepare('select key, value from settings where key in (?, ?)').all(KEYS.goal, KEYS.mission) as { key: string; value: string }[];
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  return {
    goal: parseBudget(byKey.get(KEYS.goal), CONFIG.worker.stepBudget),
    mission: parseBudget(byKey.get(KEYS.mission), CONFIG.mission.subtaskStepBudget),
  };
}

/** Grava só as chaves presentes no patch (`undefined` mantém o valor gravado antes); devolve o estado novo. */
export function writeStepBudgets(db: DatabaseSync, patch: Partial<StepBudgets>): StepBudgets {
  const upsert = db.prepare("insert into settings (key, value, updated_at) values (?, ?, datetime('now')) on conflict(key) do update set value=excluded.value, updated_at=excluded.updated_at");
  if (patch.goal !== undefined) upsert.run(KEYS.goal, JSON.stringify(patch.goal));
  if (patch.mission !== undefined) upsert.run(KEYS.mission, JSON.stringify(patch.mission));
  return readStepBudgets(db);
}
