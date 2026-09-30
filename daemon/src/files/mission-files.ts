import type { DatabaseSync } from 'node:sqlite';
import { FILES_IN_PROMPT, latestByLabel, listFiles } from '../db/files.js';
import type { IdentityRow } from '../db/identities.js';
import { getMission } from '../db/missions.js';
import type { MissionFiles } from '../worker/mission-tools.js';
import { FileError, type FileService } from './service.js';

/** Folga para o relógio do emulador e um arquivo baixado logo no começo da missão. */
const SINCE_SLACK_SEC = 60;

/** Início da missão (datetime UTC do SQLite) em epoch, menos a folga: "arquivo novo" = modificado depois disto. */
export function missionSinceSec(createdAt: string | undefined): number {
  const t = createdAt ? Date.parse(`${createdAt.replace(' ', 'T')}Z`) : NaN;
  return Number.isFinite(t) ? Math.floor(t / 1000) - SINCE_SLACK_SEC : 0;
}

const missionSince = (m: { runStartedAt: string | null; createdAt: string } | null) => missionSinceSec(m ? m.runStartedAt ?? m.createdAt : undefined);

/** Tools file_* do executor presas a esta identidade e a esta missão (spec arquivos). */
export function bindMissionFiles(svc: FileService, db: DatabaseSync, identity: IdentityRow, missionId: string): MissionFiles {
  return {
    list: () => listFiles(db, FILES_IN_PROMPT),
    exportFile: (label, devicePath) => (devicePath
      ? svc.exportFile({ identity, devicePath, label, missionId })
      : svc.exportNewest({ identity, sinceSec: missionSince(getMission(db, missionId)), label, missionId })),
    capture: async (label, crop) => {
      const file = await svc.captureScreen({ identity, label, missionId, crop });
      const { devicePath } = await svc.importFile({ file, identity });
      return { file, devicePath };
    },
    importFile: async (label) => {
      const file = latestByLabel(db, label);
      if (!file) throw new FileError('not-found', `nenhum arquivo guardado com o label ${label} (veja file_list)`);
      return svc.importFile({ file, identity });
    },
  };
}
