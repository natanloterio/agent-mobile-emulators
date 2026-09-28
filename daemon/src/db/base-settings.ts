import type { DatabaseSync } from 'node:sqlite';
import { CONFIG } from '../config.js';

const TARGET_VERSION_KEY = 'targetApp.versionName';
const BASE_PREP_KEY = 'base.prep';

function readJson(db: DatabaseSync, key: string): unknown {
  const row = db.prepare('select value from settings where key=?').get(key) as { value: string } | undefined;
  if (!row) return undefined;
  try { return JSON.parse(row.value); } catch { return undefined; }
}
function writeJson(db: DatabaseSync, key: string, value: unknown): void {
  db.prepare("insert into settings (key, value, updated_at) values (?, ?, datetime('now')) on conflict(key) do update set value=excluded.value, updated_at=excluded.updated_at")
    .run(key, JSON.stringify(value));
}

/**
 * Versão oficial do app alvo: a que o preparo do celular-base instalou (vira `appVersionName` de cada identidade nova,
 * que a sonda compara). Sem preparo feito pelo Tapflock, vale a do CONFIG.
 */
export function readTargetVersion(db: DatabaseSync): string {
  const v = readJson(db, TARGET_VERSION_KEY);
  return typeof v === 'string' && v ? v : CONFIG.targetApp.versionName;
}
export function writeTargetVersion(db: DatabaseSync, version: string): void { writeJson(db, TARGET_VERSION_KEY, version); }

export type BasePhase = 'avd' | 'boot' | 'mcp' | 'google' | 'app' | 'finish';
export type BasePrepState = 'idle' | 'running' | 'needs-google' | 'needs-human' | 'failed' | 'done';
/** Andamento do preparo do celular-base; persistido para sobreviver a um reinício do daemon. */
export interface BasePrep {
  readonly state: BasePrepState; readonly phase: BasePhase | null; readonly error: string | null;
  readonly missionId: string | null; readonly humanReason: string | null; readonly progress: number | null;
}
export const IDLE_PREP: BasePrep = { state: 'idle', phase: null, error: null, missionId: null, humanReason: null, progress: null };

export function readBasePrep(db: DatabaseSync): BasePrep {
  const v = readJson(db, BASE_PREP_KEY);
  return v && typeof v === 'object' ? { ...IDLE_PREP, ...(v as Partial<BasePrep>) } : IDLE_PREP;
}
export function writeBasePrep(db: DatabaseSync, p: BasePrep): void { writeJson(db, BASE_PREP_KEY, p); }
