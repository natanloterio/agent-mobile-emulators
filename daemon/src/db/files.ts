import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/** Arquivo guardado no host (spec arquivos): tirado de um device, pode ir para outros. */
export interface FleetFile {
  readonly id: string; readonly label: string; readonly name: string; readonly mime: string; readonly sizeBytes: number;
  readonly sha256: string; readonly hostPath: string; readonly sourceIdentityId: string | null; readonly sourceMissionId: string | null;
  readonly sourcePath: string | null; readonly createdAt: string;
}
export type NewFleetFile = Omit<FleetFile, 'id' | 'createdAt'>;

const COLS = 'id, label, name, mime, size_bytes, sha256, host_path, source_identity_id, source_mission_id, source_path, created_at';

function fromRow(x: Record<string, unknown>): FleetFile {
  return {
    id: String(x.id), label: String(x.label), name: String(x.name), mime: String(x.mime), sizeBytes: Number(x.size_bytes),
    sha256: String(x.sha256), hostPath: String(x.host_path), sourceIdentityId: (x.source_identity_id as string | null) ?? null,
    sourceMissionId: (x.source_mission_id as string | null) ?? null, sourcePath: (x.source_path as string | null) ?? null, createdAt: String(x.created_at),
  };
}

export function insertFile(db: DatabaseSync, f: NewFleetFile, id: string = randomUUID()): string {
  db.prepare(`insert into fleet_file (id, label, name, mime, size_bytes, sha256, host_path, source_identity_id, source_mission_id, source_path)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, f.label, f.name, f.mime, f.sizeBytes, f.sha256, f.hostPath, f.sourceIdentityId, f.sourceMissionId, f.sourcePath);
  return id;
}

export function getFile(db: DatabaseSync, id: string): FleetFile | null {
  const x = db.prepare(`select ${COLS} from fleet_file where id=?`).get(id) as Record<string, unknown> | undefined;
  return x ? fromRow(x) : null;
}

/** O mesmo label pode ser exportado de novo: vale o mais recente. */
export function latestByLabel(db: DatabaseSync, label: string): FleetFile | null {
  const x = db.prepare(`select ${COLS} from fleet_file where label=? order by created_at desc, rowid desc limit 1`).get(label) as Record<string, unknown> | undefined;
  return x ? fromRow(x) : null;
}

export function listFiles(db: DatabaseSync, limit: number): readonly FleetFile[] {
  return (db.prepare(`select ${COLS} from fleet_file order by created_at desc, rowid desc limit ?`).all(limit) as Record<string, unknown>[]).map(fromRow);
}

export function deleteFileRow(db: DatabaseSync, id: string): FleetFile | null {
  const f = getFile(db, id);
  if (f) db.prepare('delete from fleet_file where id=?').run(id);
  return f;
}

/** Arquivos que o planejador e o executor da missão veem por ciclo (os mais recentes bastam). */
export const FILES_IN_PROMPT = 20;

/** Uma linha por arquivo para os prompts: `label: nome (tipo, 1.2 MB), de conta1`. */
export function describeFile(f: FleetFile): string {
  const size = f.sizeBytes >= 1024 * 1024 ? `${(f.sizeBytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(f.sizeBytes / 1024))} KB`;
  return `${f.label}: ${f.name} (${f.mime}, ${size})${f.sourceIdentityId ? `, de ${f.sourceIdentityId}` : ''}`;
}
