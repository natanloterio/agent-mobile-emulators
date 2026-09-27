import type { DatabaseSync } from 'node:sqlite';
import { getIdentity, setIdentityState, type IdentityRow } from '../db/identities.js';
import {
  addMissionCost, addSubtask, getMission, listMemory, listSubtasks, recalcStalled, setMissionState, type MissionRow, type MissionState,
} from '../db/missions.js';
import { setTaskState } from '../db/tasks.js';
import { LANGS, type Lang } from '../leader/lang.js';
import { summarizeScreen } from '../screen/human-check.js';
import type { ScreenState } from '../screen/parse.js';
import { missionInstruction } from '../worker/mission-prompt.js';
import { settleIdentity } from '../worker/stop.js';
import type { PlannerDecision, PlannerInput } from './planner.js';

export interface SubtaskJob { readonly identity: IdentityRow; readonly missionId: string; readonly taskId: string; readonly instruction: string; readonly shouldStop: () => boolean }
export interface SubtaskResult { readonly humanReason: string | null; readonly summary: string }
export interface MissionDeps {
  readonly db: DatabaseSync;
  readonly isKilled: () => boolean;
  readonly plan: (input: PlannerInput) => Promise<{ decision: PlannerDecision; costUsd: number }>;
  /** Roda o executor; deve deixar a subtarefa num estado final (done/failed/needs-human/interrupted). */
  readonly runSubtask: (job: SubtaskJob) => Promise<SubtaskResult>;
  /** Lê a tela atual; lança se o device não responde. */
  readonly readScreen: (identity: IdentityRow) => Promise<ScreenState>;
  readonly promote: (missionId: string) => Promise<unknown>;
  /** Máscara dos segredos já guardados da missão (lê o cofre); lança VaultError se o cofre não abre. */
  readonly mask: (missionId: string) => Promise<(s: string) => string>;
  readonly onChange?: () => void;
}

export const PAUSE_REASON = {
  kill: 'kill switch', control: 'controle humano', paused: 'identidade pausada', gone: 'identidade indisponível', user: 'pausada pelo usuário',
} as const;

const msg = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 200);
const asLang = (l: string): Lang => ((LANGS as readonly string[]).includes(l) ? (l as Lang) : 'pt');

function stopReason(d: MissionDeps, i: IdentityRow | null): string | null {
  if (d.isKilled()) return PAUSE_REASON.kill;
  if (!i || i.discardedAt || i.state === 'banned') return PAUSE_REASON.gone;
  // Outro subsistema (ex.: sonda de restauração/login) marcou needs-human: não sobrescrever rodando de novo.
  if (i.state === 'needs-human') return `identidade precisa de humano: ${i.lastError ?? 'sem detalhe'}`.slice(0, 200);
  if (i.controlled) return PAUSE_REASON.control;
  if (i.paused) return PAUSE_REASON.paused;
  return null;
}

function pause(d: MissionDeps, m: MissionRow, reason: string): MissionState {
  setMissionState(d.db, m.id, 'paused', reason);
  settleIdentity(d.db, m.identityId); // só desfaz o 'running' do loop
  d.onChange?.();
  return 'paused';
}

function toHuman(d: MissionDeps, m: MissionRow, reason: string): MissionState {
  setMissionState(d.db, m.id, 'awaiting-human', reason);
  setIdentityState(d.db, m.identityId, 'needs-human', { lastError: reason });
  d.onChange?.();
  return 'awaiting-human';
}

/** Missão mudou de estado por fora (pausa/abandono do usuário) enquanto o loop esperava: sai sem sobrescrever. */
function leftRunning(d: MissionDeps, m: MissionRow): MissionState | null {
  const cur = getMission(d.db, m.id);
  if (cur?.state === 'running') return null;
  settleIdentity(d.db, m.identityId);
  d.onChange?.();
  return cur?.state ?? 'abandoned';
}

/** Texto do planejador pode ecoar um segredo que estava na tela: mascarado antes de virar subtarefa/motivo. */
function maskDecision(dec: PlannerDecision, mask: (s: string) => string): PlannerDecision {
  if (dec.kind === 'next') return { ...dec, objective: mask(dec.objective), successCriteria: mask(dec.successCriteria), rationale: mask(dec.rationale) };
  if (dec.kind === 'done') return { ...dec, summary: mask(dec.summary) };
  return { ...dec, reason: mask(dec.reason) };
}

const taskState = (db: DatabaseSync, taskId: string) => (db.prepare('select state from task where id=?').get(taskId) as { state: string } | undefined)?.state ?? 'failed';

/** Um ciclo: tela → planejador → executor → resultado. Repete até a missão sair de `running` (spec missões §O loop). */
export async function runMission(missionId: string, d: MissionDeps): Promise<MissionState> {
  for (;;) {
    const m = getMission(d.db, missionId);
    if (!m || m.state !== 'running') return m?.state ?? 'abandoned';
    const identity = getIdentity(d.db, m.identityId);
    const stop = stopReason(d, identity);
    if (stop || !identity) return pause(d, m, stop ?? PAUSE_REASON.gone);
    setIdentityState(d.db, identity.id, 'running', { lastError: null });
    d.onChange?.();

    let screen: ScreenState;
    try { screen = await d.readScreen(identity); }
    catch (e) { return pause(d, m, `device indisponível: ${msg(e)}`); }

    let mask: (s: string) => string;
    try { mask = await d.mask(m.id); }
    catch (e) { return pause(d, m, `cofre: ${msg(e)}`); }

    let decision: PlannerDecision;
    try {
      const r = await d.plan({
        missionText: m.text, identity: { name: identity.name, handle: identity.handle, appPackage: identity.appPackage },
        memory: listMemory(d.db, m.id), subtasks: listSubtasks(d.db, m.id), screen: mask(summarizeScreen(screen)), lang: asLang(m.lang),
      });
      addMissionCost(d.db, m.id, r.costUsd);
      decision = maskDecision(r.decision, mask);
    } catch (e) { return pause(d, m, `planejador: ${msg(e)}`); }
    const moved = leftRunning(d, m); if (moved) return moved;
    // Kill switch/pausa/controle chegou durante o planejamento: não abre subtarefa.
    const stopNow = stopReason(d, getIdentity(d.db, m.identityId));
    if (stopNow) return pause(d, m, stopNow);

    if (decision.kind === 'done') {
      setMissionState(d.db, m.id, 'done');
      setIdentityState(d.db, identity.id, 'idle', { lastError: null });
      try { await d.promote(m.id); } catch (e) { console.error('[missão] promoção falhou:', msg(e)); }
      d.onChange?.();
      return 'done';
    }
    if (decision.kind === 'human') return toHuman(d, m, decision.reason);

    const taskId = addSubtask(d.db, m.id, decision.objective, decision.successCriteria);
    d.onChange?.();
    const instruction = missionInstruction({ objective: decision.objective, successCriteria: decision.successCriteria, memory: listMemory(d.db, m.id), missionText: m.text });
    const shouldStop = () => d.isKilled() || getMission(d.db, m.id)?.state !== 'running';
    let r: SubtaskResult;
    try { r = await d.runSubtask({ identity, missionId: m.id, taskId, instruction, shouldStop }); }
    catch (e) {
      if (['running', 'todo'].includes(taskState(d.db, taskId))) setTaskState(d.db, taskId, 'interrupted');
      return leftRunning(d, m) ?? pause(d, m, `executor: ${msg(e)}`);
    }
    recalcStalled(d.db, m.id);
    d.onChange?.();

    const st = taskState(d.db, taskId);
    if (st === 'needs-human') return toHuman(d, m, r.humanReason ?? 'verificação humana');
    if (st === 'interrupted') {
      const movedNow = leftRunning(d, m); if (movedNow) return movedNow;
      return pause(d, m, stopReason(d, getIdentity(d.db, m.identityId)) ?? `infra: ${r.summary.slice(0, 160) || 'device ou modelo indisponível'}`);
    }
  }
}
