import type { DatabaseSync } from 'node:sqlite';
import { listFiles } from '../db/files.js';

const FILES_LIMIT = 30;

/** Arquivo como a tela vê: sem o caminho no host nem o hash. */
export interface FleetFileView {
  readonly id: string; readonly label: string; readonly name: string; readonly mime: string; readonly sizeBytes: number;
  readonly sourceIdentityId: string | null; readonly sourceMissionId: string | null; readonly createdAt: string;
}

export function fileViews(db: DatabaseSync, limit = FILES_LIMIT): readonly FleetFileView[] {
  return listFiles(db, limit).map((f) => ({
    id: f.id, label: f.label, name: f.name, mime: f.mime, sizeBytes: f.sizeBytes,
    sourceIdentityId: f.sourceIdentityId, sourceMissionId: f.sourceMissionId, createdAt: f.createdAt,
  }));
}
