import { PT, type I18n } from '../i18n/translate';
import type { FleetSnapshot, MissionView } from '../live/types';

const OPEN = new Set(['running', 'awaiting-human', 'paused', 'waiting']);
export const isOpenMission = (m: MissionView): boolean => OPEN.has(m.state);

/** Missão a mostrar para a identidade: a aberta, senão a mais recente. O daemon já manda as abertas primeiro. */
export function missionForIdentity(snap: FleetSnapshot | null, identityId: string | undefined): MissionView | null {
  if (!snap?.missions || !identityId) return null;
  const mine = snap.missions.filter((m) => m.identityId === identityId);
  return mine.find(isOpenMission) ?? mine[0] ?? null;
}

/** `then` que o bloco de instrução manda com a nota (spec instruções): awaiting-human continua, paused retoma. */
export function missionInstructThen(state: MissionView['state']): 'continue' | 'resume' | undefined {
  return state === 'awaiting-human' ? 'continue' : state === 'paused' ? 'resume' : undefined;
}

export function missionTaskLabel(m: MissionView, { t }: I18n = PT): string {
  if (m.state === 'awaiting-human') return t('mission.tile.awaiting', { reason: m.humanReason ?? '' });
  if (m.state === 'paused') return t('mission.tile.paused', { reason: m.humanReason ?? '' });
  if (m.state === 'waiting') return t('mission.tile.waiting');
  if (m.current) return t('mission.tile.subtask', { n: m.current.seq, objective: m.current.objective });
  return t('mission.tile.planning');
}

export interface TimelineRow { readonly seq: number; readonly objective: string; readonly mark: '✓' | '✗' | '!' | '⏸' | '…'; readonly did: string; readonly blockers: string }
const MARK: Readonly<Record<string, TimelineRow['mark']>> = { done: '✓', failed: '✗', 'needs-human': '!', interrupted: '⏸', running: '…' };

export function missionTimeline(m: MissionView): readonly TimelineRow[] {
  return m.subtasks.map((s) => ({ seq: s.seq, objective: s.objective, mark: MARK[s.state] ?? '…', did: s.report?.did ?? '', blockers: s.report?.blockers ?? '' }));
}

/** SQLite grava 'YYYY-MM-DD HH:MM:SS' em UTC; ISO passa direto. */
const utcMs = (at: string) => Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(at) ? at : `${at.replace(' ', 'T')}Z`);

export function missionElapsed(m: MissionView, now: number, { t }: I18n = PT): string {
  const end = m.finishedAt ? utcMs(m.finishedAt) : now;
  const min = Math.max(0, Math.floor((end - utcMs(m.startedAt)) / 60_000));
  return min < 60 ? t('mission.elapsed.min', { m: min }) : t('mission.elapsed.hmin', { h: Math.floor(min / 60), m: min % 60 });
}
