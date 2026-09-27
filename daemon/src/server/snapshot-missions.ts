import type { DatabaseSync } from 'node:sqlite';
import { listMemory, listMissions, listSubtasks, type MissionState, type SubtaskReport } from '../db/missions.js';

export interface MissionView {
  readonly id: string; readonly identityId: string; readonly text: string; readonly state: MissionState;
  readonly humanReason: string | null; readonly stalled: boolean; readonly costUsd: number; readonly startedAt: string; readonly finishedAt: string | null;
  readonly current: { readonly seq: number; readonly objective: string } | null;
  readonly subtasks: readonly { readonly seq: number; readonly objective: string; readonly state: string; readonly report: SubtaskReport | null; readonly costUsd: number }[];
  readonly memory: readonly { readonly key: string; readonly value: string | null; readonly secret: boolean }[];
}

/** Missões para o snapshot: abertas primeiro. Segredo sai só como chave (value null). */
export function missionViews(db: DatabaseSync, limit = 20): readonly MissionView[] {
  return listMissions(db, limit).map((m) => {
    const subs = listSubtasks(db, m.id);
    const cur = subs.find((s) => s.state === 'running');
    return {
      id: m.id, identityId: m.identityId, text: m.text, state: m.state, humanReason: m.humanReason, stalled: m.stalled,
      costUsd: m.costUsd, startedAt: m.createdAt, finishedAt: m.finishedAt,
      current: cur ? { seq: cur.seq, objective: cur.objective } : null,
      subtasks: subs.map((s) => ({ seq: s.seq, objective: s.objective, state: s.state, report: s.report, costUsd: s.costUsd })),
      memory: listMemory(db, m.id).map((x) => ({ key: x.key, value: x.secret ? null : x.value, secret: x.secret })),
    };
  });
}
