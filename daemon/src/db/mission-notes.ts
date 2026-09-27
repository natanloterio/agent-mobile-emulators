import type { DatabaseSync } from 'node:sqlite';

/** Instrução do operador para uma missão (spec instruções): texto livre, com o selo de leitura pela subtarefa. */
export interface NoteRow {
  readonly id: number; readonly text: string; readonly createdAt: string; readonly readAt: string | null; readonly readSeq: number | null;
}

function fromRow(x: Record<string, unknown>): NoteRow {
  return {
    id: Number(x.id), text: String(x.text), createdAt: String(x.created_at),
    readAt: (x.read_at as string | null) ?? null, readSeq: x.read_seq == null ? null : Number(x.read_seq),
  };
}

const COLS = 'id, text, created_at, read_at, read_seq';

/** Grava a instrução do operador (já mascarada pelo chamador); devolve o id da nota. */
export function addNote(db: DatabaseSync, missionId: string, text: string): number {
  const r = db.prepare('insert into mission_note (goal_id, text) values (?, ?)').run(missionId, text);
  return Number(r.lastInsertRowid);
}

/** Histórico completo da missão, mais recente primeiro (tela e prompt do planejador). */
export function listNotes(db: DatabaseSync, missionId: string): readonly NoteRow[] {
  return (db.prepare(`select ${COLS} from mission_note where goal_id=? order by id desc`).all(missionId) as Record<string, unknown>[]).map(fromRow);
}

/** Ainda não lidas, na ordem em que foram escritas (o executor injeta uma por vez, na ordem certa). */
export function unreadNotes(db: DatabaseSync, missionId: string): readonly NoteRow[] {
  return (db.prepare(`select ${COLS} from mission_note where goal_id=? and read_at is null order by id asc`).all(missionId) as Record<string, unknown>[]).map(fromRow);
}

/** Marca como lidas as notas dadas que ainda não tinham leitura (a primeira leitura vence: o selo não recua nem avança depois). */
export function markNotesRead(db: DatabaseSync, ids: readonly number[], seq: number): void {
  if (!ids.length) return;
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`update mission_note set read_at=datetime('now'), read_seq=? where id in (${placeholders}) and read_at is null`).run(seq, ...ids);
}
