import { baseStage } from '../components/baseAvdStage';
import type { FleetSnapshot, LiveIdentity } from '../live/types';

/** Estado de um marco do checklist (spec guia §2). */
export type MilestoneState = 'todo' | 'doing' | 'needs-you' | 'done' | 'failed';
export type Milestones = readonly [MilestoneState, MilestoneState, MilestoneState, MilestoneState];
export type MilestoneIndex = 0 | 1 | 2 | 3;

export interface GuideInput {
  /** Onboarding concluído; sem ponte de setup (navegador) conta como concluído. */
  readonly setupCompleted: boolean;
  /** Último snapshot do daemon; null enquanto não chegou nenhum. */
  readonly snap: FleetSnapshot | null;
  /** A configuração já terminou numa sessão anterior: não volta a ficar incompleta (spec guia §2). */
  readonly alreadyCompleted?: boolean;
}

export interface GuideProgress {
  readonly milestones: Milestones;
  /** Primeiro marco que não está feito; null com o checklist completo. */
  readonly current: MilestoneIndex | null;
  /** Conta que o Guia acompanha nos marcos 3 e 4: a conectada, senão a que espera login. */
  readonly account: LiveIdentity | null;
  /** Celular-base ligado por fora do preparo: bloqueia criar celular até ser desligado. */
  readonly baseRunning: boolean;
}

/** Espelha o `NO_ACCOUNT` do daemon (routes-identities.ts): identidade criada, ainda sem login. */
const NO_ACCOUNT = 'sem conta';
const AWAITING_LOGIN = new Set(['blank', 'provisioned']);
const GOAL_DONE = new Set(['done', 'partial']);

export const lifecycleOf = (i: LiveIdentity) => i.lifecycle ?? i.state;
const usable = (i: LiveIdentity) => !i.discardedAt && !i.bannedReason && lifecycleOf(i) !== 'banned';
const awaitingLogin = (i: LiveIdentity) => AWAITING_LOGIN.has(lifecycleOf(i)) || !i.handle || i.handle === NO_ACCOUNT;
/**
 * Conectada = login feito e não banida. Os 5 sinais de prontidão não entram: o daemon só os grava na sonda da frota
 * (ao planejar um objetivo), então eles são checados no marco 4.
 */
export const isConnected = (i: LiveIdentity) => usable(i) && !awaitingLogin(i);

function baseMilestone(snap: FleetSnapshot): MilestoneState {
  // Daemon antigo não informa o celular-base: não há como guiar, então não trava o checklist.
  if (!snap.baseAvd) return 'done';
  const prep = snap.baseAvd.prep?.state;
  if (prep === 'running') return 'doing';
  if (prep === 'needs-google' || prep === 'needs-human') return 'needs-you';
  if (prep === 'failed') return 'failed';
  const stage = baseStage(snap.baseAvd);
  if (stage === 'running') return 'needs-you';
  return stage === null ? 'done' : 'todo';
}

function pickAccount(snap: FleetSnapshot): LiveIdentity | null {
  const live = snap.identities.filter(usable);
  return live.find(isConnected) ?? live.find(awaitingLogin) ?? null;
}

function accountMilestone(account: LiveIdentity | null): MilestoneState {
  if (!account) return 'todo';
  if (isConnected(account)) return 'done';
  if (account.booting || !account.online) return 'doing';
  return 'needs-you';
}

function taskMilestone(snap: FleetSnapshot, account: LiveIdentity | null): MilestoneState {
  const missions = snap.missions ?? [];
  const goal = snap.goal ?? null;
  if ((goal && GOAL_DONE.has(goal.state)) || missions.some((m) => m.state === 'done')) return 'done';
  if (missions.some((m) => m.state === 'awaiting-human')) return 'needs-you';
  const running = goal?.state === 'running' || missions.some((m) => m.state === 'running' || m.state === 'waiting');
  if (running) return account && lifecycleOf(account) === 'needs-human' ? 'needs-you' : 'doing';
  return goal?.state === 'failed' ? 'failed' : 'todo';
}

/** Checklist de configuração do Guia (spec guia §2), derivado só do snapshot: reabrir o app retoma no mesmo ponto. */
export function guideProgress({ setupCompleted, snap, alreadyCompleted = false }: GuideInput): GuideProgress {
  const account = snap ? pickAccount(snap) : null;
  // Concluída uma vez, fica concluída: um objetivo novo que falhou ou uma conta banida depois não reabrem o checklist.
  if (alreadyCompleted) return { milestones: ['done', 'done', 'done', 'done'], current: null, account, baseRunning: false };
  const raw: MilestoneState[] = [
    setupCompleted ? 'done' : 'todo',
    snap ? baseMilestone(snap) : 'todo',
    snap ? accountMilestone(account) : 'todo',
    snap ? taskMilestone(snap, account) : 'todo',
  ];
  // Um marco só anda com os anteriores feitos.
  const firstOpen = raw.findIndex((m) => m !== 'done');
  const milestones = raw.map((m, i) => (firstOpen >= 0 && i > firstOpen ? 'todo' : m)) as unknown as Milestones;
  return {
    milestones,
    current: firstOpen < 0 ? null : (firstOpen as MilestoneIndex),
    account,
    baseRunning: baseStage(snap?.baseAvd) === 'running',
  };
}
