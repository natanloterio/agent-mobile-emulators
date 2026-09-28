import type { DatabaseSync } from 'node:sqlite';
import { latestByLabel, type FleetFile } from '../db/files.js';
import { getIdentity, type IdentityRow } from '../db/identities.js';
import { addNote } from '../db/mission-notes.js';
import { getMission, setMissionState, waitingOn, type MissionRow } from '../db/missions.js';
import { missionSinceSec } from '../files/mission-files.js';
import type { FileService } from '../files/service.js';

/** O que a entrega entre etapas usa do serviço de arquivos (spec arquivos). */
export type HandoffFiles = Pick<FileService, 'exportNewest' | 'importFile'>;

export interface HandoffDeps {
  readonly db: DatabaseSync;
  readonly files?: HandoffFiles;
  /** Motivo para a próxima etapa não rodar agora (kill switch, identidade pausada/sob controle/banida); null = pode. */
  readonly block: (identityId: string) => string | null;
  readonly launch: (missionId: string) => void;
  readonly onChange?: () => void;
}

export const ABANDONED_BEFORE = 'a etapa anterior foi abandonada';

/** Label do arquivo que a etapa `k` (0-based) de uma sequência entrega à seguinte. */
export const handoffLabel = (chainId: string, k: number): string => `handoff.${chainId}.${k + 1}`;

const pt = (lang: string) => lang.startsWith('pt');

/** Nota da etapa que entrega: o planejador trata instrução do operador como prioridade. */
export function deliverNote(lang: string, nextName: string, label: string): string {
  return pt(lang)
    ? `Esta missão faz parte de uma sequência: o arquivo que ela baixar ou produzir vai depois para ${nextName}. Antes de concluir, guarde-o com file_export(label="${label}"). Se não fizer, o Tapflock envia o arquivo mais novo das pastas Download/DCIM/Pictures/Movies/Documents.`
    : `This mission is part of a sequence: the file it downloads or produces goes next to ${nextName}. Before finishing, save it with file_export(label="${label}"). If you don't, Tapflock sends the newest file in Download/DCIM/Pictures/Movies/Documents.`;
}

/** Nota da etapa que recebe: onde o arquivo já está no celular. */
export function receivedNote(lang: string, prevName: string, file: FleetFile, devicePath: string): string {
  return pt(lang)
    ? `O arquivo da etapa anterior (${prevName}) já está neste celular: ${devicePath} (${file.name}, label ${file.label}). Imagens aparecem na galeria, no álbum Tapflock. Use-o nesta missão.`
    : `The file from the previous step (${prevName}) is already on this phone: ${devicePath} (${file.name}, label ${file.label}). Images show up in the gallery, in the Tapflock album. Use it in this mission.`;
}

/** Nota da etapa cujo arquivo não chegou ao celular: o planejador copia com file_import ao retomar. */
export function retryNote(lang: string, file: FleetFile): string {
  return pt(lang)
    ? `O arquivo da etapa anterior (${file.name}) está guardado no Tapflock, mas não chegou a este celular. Antes de usá-lo, copie-o com file_import(label="${file.label}").`
    : `The previous step's file (${file.name}) is kept in Tapflock but did not reach this phone. Before using it, copy it with file_import(label="${file.label}").`;
}

const msg = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 200);

/** Arquivo que a etapa entrega: o que ela mesma exportou com o label, senão o mais novo do device desde o início dela. */
async function fileFrom(prev: MissionRow, d: HandoffDeps): Promise<{ file: FleetFile | null; error: string | null }> {
  if (!prev.handoffLabel || !d.files) return { file: null, error: null };
  const own = latestByLabel(d.db, prev.handoffLabel);
  if (own && own.sourceMissionId === prev.id) return { file: own, error: null };
  const identity = getIdentity(d.db, prev.identityId);
  if (!identity) return { file: null, error: 'identidade da etapa anterior sumiu' };
  try {
    return { file: await d.files.exportNewest({ identity, sinceSec: missionSinceSec(prev.runStartedAt ?? prev.createdAt), label: prev.handoffLabel, missionId: prev.id }), error: null };
  } catch (e) { return { file: null, error: msg(e) }; }
}

async function releaseOne(next: MissionRow, prev: MissionRow, prevIdentity: IdentityRow | null, file: FleetFile | null, d: HandoffDeps): Promise<void> {
  if (getMission(d.db, next.id)?.state !== 'waiting') return; // abandonada enquanto o arquivo vinha
  const block = d.block(next.identityId);
  if (block) { setMissionState(d.db, next.id, 'paused', block); return; }
  const identity = getIdentity(d.db, next.identityId);
  if (file && identity && d.files) {
    try {
      const { devicePath } = await d.files.importFile({ file, identity });
      addNote(d.db, next.id, receivedNote(next.lang, prevIdentity?.name ?? prev.identityId, file, devicePath));
    } catch (e) {
      // O arquivo está guardado no Tapflock: ao retomar, o planejador sabe o label para copiá-lo com file_import.
      addNote(d.db, next.id, retryNote(next.lang, file));
      setMissionState(d.db, next.id, 'paused', `envio do arquivo falhou: ${msg(e)}`);
      return;
    }
  }
  if (getMission(d.db, next.id)?.state !== 'waiting') return;
  setMissionState(d.db, next.id, 'running');
  d.launch(next.id);
}

/**
 * Etapa `prev` terminou (done): leva o arquivo dela para cada etapa que a espera e as lança (spec arquivos §Sequência).
 * Sem arquivo para entregar, a próxima pausa com o motivo; o operador pode retomar (roda sem o arquivo) ou abandonar.
 */
export async function handOff(prev: MissionRow, d: HandoffDeps): Promise<void> {
  const next = waitingOn(d.db, prev.id);
  if (!next.length) return;
  const { file, error } = await fileFrom(prev, d);
  const prevIdentity = getIdentity(d.db, prev.identityId);
  for (const m of next) {
    if (error) { if (getMission(d.db, m.id)?.state === 'waiting') setMissionState(d.db, m.id, 'paused', `a etapa anterior terminou sem entregar arquivo: ${error}`); continue; }
    await releaseOne(m, prev, prevIdentity, file, d);
  }
  d.onChange?.();
}

/** Etapa abandonada: quem a esperava pausa (o operador decide se roda mesmo assim). */
export function cancelWaiting(db: DatabaseSync, prevId: string): void {
  for (const m of waitingOn(db, prevId)) setMissionState(db, m.id, 'paused', ABANDONED_BEFORE);
}
