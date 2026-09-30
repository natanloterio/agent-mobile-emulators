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

const LOCAL_PARALLEL_KEY = 'local.parallel';
const LOCAL_PARALLEL_DEFAULT = 1;
const LOCAL_PARALLEL_MIN = 1;
const LOCAL_PARALLEL_MAX = 8;

/**
 * Gerações simultâneas no modelo local (spec paralelismo §UI): chave `local.parallel`, default 1, válido 1..8;
 * ausente ou ilegível cai no default. Lido a cada `ensure()`/apply — nunca cacheado (mesmo padrão dos limites).
 */
export function readLocalParallel(db: DatabaseSync): number {
  const row = db.prepare('select value from settings where key=?').get(LOCAL_PARALLEL_KEY) as { value: string } | undefined;
  if (!row) return LOCAL_PARALLEL_DEFAULT;
  let v: unknown;
  try { v = JSON.parse(row.value); } catch { return LOCAL_PARALLEL_DEFAULT; }
  return typeof v === 'number' && Number.isInteger(v) && v >= LOCAL_PARALLEL_MIN && v <= LOCAL_PARALLEL_MAX ? v : LOCAL_PARALLEL_DEFAULT;
}

/** Grava o paralelismo local (patch total, um valor só); devolve o estado novo já validado pela leitura. */
export function writeLocalParallel(db: DatabaseSync, n: number): number {
  db.prepare("insert into settings (key, value, updated_at) values (?, ?, datetime('now')) on conflict(key) do update set value=excluded.value, updated_at=excluded.updated_at")
    .run(LOCAL_PARALLEL_KEY, JSON.stringify(n));
  return readLocalParallel(db);
}

const GUIDE_COMPLETED_KEY = 'guide.completed';

/**
 * Configuração do Guia concluída (spec guia §2): fica no banco, junto com os dados que a tornaram concluída; outro
 * `TAPFLOCK_DATA_DIR` começa do zero. Ausente ou ilegível = não concluída.
 */
export function readGuideCompleted(db: DatabaseSync): boolean {
  const row = db.prepare('select value from settings where key=?').get(GUIDE_COMPLETED_KEY) as { value: string } | undefined;
  if (!row) return false;
  try { return JSON.parse(row.value) === true; } catch { return false; }
}

export function writeGuideCompleted(db: DatabaseSync, completed: boolean): boolean {
  db.prepare("insert into settings (key, value, updated_at) values (?, ?, datetime('now')) on conflict(key) do update set value=excluded.value, updated_at=excluded.updated_at")
    .run(GUIDE_COMPLETED_KEY, JSON.stringify(completed));
  return readGuideCompleted(db);
}
