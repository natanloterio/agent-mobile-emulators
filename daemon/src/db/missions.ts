import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export type MissionState = 'running' | 'awaiting-human' | 'paused' | 'done' | 'abandoned';
/** Estados em que a missão prende a identidade (spec missões §Ciclo de vida). */
export const OPEN_MISSION_STATES: readonly MissionState[] = ['running', 'awaiting-human', 'paused'];
export type SubtaskState = 'running' | 'done' | 'failed' | 'needs-human' | 'interrupted';
export interface SubtaskReport { readonly ok: boolean; readonly did: string; readonly blockers: string }
export interface MissionRow {
  readonly id: string; readonly identityId: string; readonly text: string; readonly state: MissionState; readonly humanReason: string | null;
  readonly stalled: boolean; readonly lang: string; readonly costUsd: number; readonly createdAt: string; readonly finishedAt: string | null;
}
export interface SubtaskRow {
  readonly id: string; readonly seq: number; readonly objective: string; readonly successCriteria: string; readonly state: string;
  readonly report: SubtaskReport | null; readonly costUsd: number;
}
export interface MemoryRow { readonly key: string; readonly value: string; readonly secret: boolean }

const OPEN_SQL = OPEN_MISSION_STATES.map((s) => `'${s}'`).join(',');
const COLS = 'id, identity_id, text, mission_state, human_reason, stalled, lang, cost_usd, created_at, finished_at';

function fromRow(x: Record<string, unknown>): MissionRow {
  return {
    id: String(x.id), identityId: String(x.identity_id), text: String(x.text), state: x.mission_state as MissionState,
    humanReason: (x.human_reason as string | null) ?? null, stalled: Number(x.stalled) === 1, lang: String(x.lang ?? 'pt'),
    costUsd: Number(x.cost_usd), createdAt: String(x.created_at), finishedAt: (x.finished_at as string | null) ?? null,
  };
}

function parseReport(raw: unknown): SubtaskReport | null {
  if (typeof raw !== 'string' || !raw) return null;
  try { const r = JSON.parse(raw) as SubtaskReport; return { ok: !!r.ok, did: String(r.did ?? ''), blockers: String(r.blockers ?? '') }; } catch { return null; }
}

export function createMission(db: DatabaseSync, identityId: string, text: string, lang: string): string {
  const id = randomUUID();
  db.prepare("insert into goal (id, text, pattern, state, mission_state, identity_id, lang) values (?, ?, 'mission', 'running', 'running', ?, ?)").run(id, text, identityId, lang);
  return id;
}

export function getMission(db: DatabaseSync, id: string): MissionRow | null {
  const x = db.prepare(`select ${COLS} from goal where id=? and pattern='mission'`).get(id) as Record<string, unknown> | undefined;
  return x ? fromRow(x) : null;
}

export function openMissionFor(db: DatabaseSync, identityId: string): MissionRow | null {
  const x = db.prepare(`select ${COLS} from goal where pattern='mission' and identity_id=? and mission_state in (${OPEN_SQL}) order by created_at desc, rowid desc limit 1`).get(identityId) as Record<string, unknown> | undefined;
  return x ? fromRow(x) : null;
}

export function listMissions(db: DatabaseSync, limit = 20): readonly MissionRow[] {
  return (db.prepare(`select ${COLS} from goal where pattern='mission' order by (mission_state in (${OPEN_SQL})) desc, created_at desc, rowid desc limit ?`).all(limit) as Record<string, unknown>[]).map(fromRow);
}

/** `goal.state` segue a missão para o relatório: done → done, abandoned → failed, resto → running. */
export function setMissionState(db: DatabaseSync, id: string, state: MissionState, humanReason: string | null = null): void {
  const goalState = state === 'done' ? 'done' : state === 'abandoned' ? 'failed' : 'running';
  const closed = state === 'done' || state === 'abandoned';
  db.prepare(`update goal set mission_state=?, human_reason=?, state=?, finished_at=${closed ? "datetime('now')" : 'null'} where id=? and pattern='mission'`)
    .run(state, humanReason, goalState, id);
}

export function addSubtask(db: DatabaseSync, missionId: string, objective: string, successCriteria: string): string {
  const taskId = randomUUID();
  db.prepare(`insert into task (id, goal_id, identity_id, instruction, state, attempts, seq, objective, success_criteria)
    values (?, ?, (select identity_id from goal where id=?), ?, 'running', 1, (select coalesce(max(seq), 0) + 1 from task where goal_id=?), ?, ?)`)
    .run(taskId, missionId, missionId, objective, missionId, objective, successCriteria);
  return taskId;
}

/** Seq da subtarefa (spec instruções): o loop marca as notas lidas com o seq da subtarefa recém-criada. */
export function subtaskSeq(db: DatabaseSync, taskId: string): number {
  return Number((db.prepare('select seq from task where id=?').get(taskId) as { seq: number }).seq);
}

export function listSubtasks(db: DatabaseSync, missionId: string): readonly SubtaskRow[] {
  return (db.prepare('select id, seq, objective, success_criteria, state, report_json, cost_usd from task where goal_id=? order by seq').all(missionId) as Record<string, unknown>[])
    .map((x) => ({ id: String(x.id), seq: Number(x.seq), objective: String(x.objective ?? ''), successCriteria: String(x.success_criteria ?? ''), state: String(x.state), report: parseReport(x.report_json), costUsd: Number(x.cost_usd) }));
}

export function setSubtaskReport(db: DatabaseSync, taskId: string, report: SubtaskReport): void {
  db.prepare('update task set report_json=? where id=?').run(JSON.stringify({ ok: report.ok, did: report.did, blockers: report.blockers }), taskId);
}

/** Subtarefas `running` de missões (todas, ou de uma) viram `interrupted`. Devolve quantas. */
export function markInterrupted(db: DatabaseSync, missionId?: string): number {
  const where = missionId ? 'goal_id=?' : "goal_id in (select id from goal where pattern='mission')";
  const r = db.prepare(`update task set state='interrupted', finished_at=datetime('now') where state in ('running','todo') and ${where}`).run(...(missionId ? [missionId] : []));
  return Number(r.changes);
}

/** `stalled` = as `n` últimas subtarefas terminaram `failed` (informativo; spec missões). */
export function recalcStalled(db: DatabaseSync, missionId: string, n = 3): boolean {
  const last = db.prepare('select state from task where goal_id=? and state != ? order by seq desc limit ?').all(missionId, 'running', n) as { state: string }[];
  const stalled = last.length === n && last.every((t) => t.state === 'failed');
  db.prepare('update goal set stalled=? where id=?').run(stalled ? 1 : 0, missionId);
  return stalled;
}

export function addMissionCost(db: DatabaseSync, missionId: string, usd: number): void {
  db.prepare('update goal set cost_usd = cost_usd + ? where id=?').run(usd, missionId);
}

export function memoryPut(db: DatabaseSync, missionId: string, key: string, value: string, secret = false): void {
  db.prepare(`insert into mission_memory (goal_id, key, value, secret) values (?, ?, ?, ?)
    on conflict(goal_id, key) do update set value=excluded.value, secret=excluded.secret, updated_at=datetime('now')`).run(missionId, key, value, secret ? 1 : 0);
}

export function memoryGet(db: DatabaseSync, missionId: string, key: string): MemoryRow | null {
  const x = db.prepare('select key, value, secret from mission_memory where goal_id=? and key=?').get(missionId, key) as { key: string; value: string; secret: number } | undefined;
  return x ? { key: x.key, value: x.value, secret: x.secret === 1 } : null;
}

export function listMemory(db: DatabaseSync, missionId: string): readonly MemoryRow[] {
  return (db.prepare('select key, value, secret from mission_memory where goal_id=? order by key').all(missionId) as { key: string; value: string; secret: number }[])
    .map((x) => ({ key: x.key, value: x.value, secret: x.secret === 1 }));
}
