import type { MessageKey } from '../i18n/messages';
import { PT, type I18n } from '../i18n/translate';
import type { GoalPlan } from '../live/types';
import { SIGNAL_ORDER } from './liveSelectors';
import { selectEstimate, selectPlanTasks, type Stat, type TileVM } from './selectors';

// Plano exibido em Novo objetivo: o do líder (modo vivo) ou o do design (demo).

export interface PlanTaskVM {
  readonly key: string; readonly name: string; readonly handle: string; readonly instr: string;
  /** Os 5 sinais da sonda na ordem boot · accessibility · initialize · tools · versionName. */
  readonly signals: readonly boolean[];
  readonly ready: boolean; readonly readyLabel: string;
}

/** De onde o plano saiu: a tela refaz o VM no idioma dela sem depender de quem o montou. */
export type PlanSource =
  | { readonly kind: 'live'; readonly plan: GoalPlan }
  | { readonly kind: 'demo'; readonly tiles: readonly TileVM[]; readonly fleetSize: number };

export interface PlanVM {
  readonly patternLabel: string;
  readonly rationale: string;
  readonly estimate: readonly Stat[];
  readonly tasks: readonly PlanTaskVM[];
  /** Líder caiu e o plano saiu da regra determinística. */
  readonly leaderWarning: string | null;
  readonly source: PlanSource;
}

const PATTERN_KEY: Readonly<Record<string, MessageKey>> = { 'fan-out': 'goal.pattern.fanOut', sharding: 'goal.pattern.sharding' };

/** `readyLabel` fixos que o daemon manda (daemon/src/leader/readiness.ts). `needs-human` é estado cru: fica como veio. */
const READY_KEY: Readonly<Record<string, MessageKey>> = {
  'pronto': 'goal.ready.ready',
  'versão mudou · fora': 'goal.ready.versionChanged',
  'pausada': 'goal.ready.paused',
  'sob controle humano': 'goal.ready.controlled',
  'aguardando login': 'goal.ready.awaitingLogin',
  'banida': 'goal.ready.banned',
  'descartada': 'goal.ready.discarded',
};
const OFFLINE_PREFIX = 'offline · ';

/** Rótulo de prontidão do daemon no idioma da tela; o detalhe depois de `offline · ` fica como veio; desconhecido passa igual. */
export function readyLabelText(raw: string, i18n: I18n = PT): string {
  const key = READY_KEY[raw];
  if (key) return i18n.t(key);
  if (raw.startsWith(OFFLINE_PREFIX)) return i18n.t('goal.ready.offline', { detail: raw.slice(OFFLINE_PREFIX.length) });
  return raw;
}

const patternLabel = (pattern: string, i18n: I18n) => {
  const key = PATTERN_KEY[pattern];
  return key ? i18n.t(key) : pattern;
};

export function selectPlanVM(p: GoalPlan, i18n: I18n = PT): PlanVM {
  const { t, fmt } = i18n;
  return {
    patternLabel: patternLabel(p.pattern, i18n),
    rationale: p.rationale,
    estimate: [
      { label: t('goal.est.readyTasks'), value: String(p.estimate.tasks) },
      { label: t('goal.est.outOfProbe'), value: String(p.estimate.outOfProbe) },
      { label: t('goal.est.stepBudget'), value: t('goal.est.stepBudgetValue', { steps: p.estimate.stepBudget }) },
      { label: t('goal.est.fleetReady'), value: t('goal.est.fleetReadyValue', { seconds: Math.ceil(p.estimate.fleetReadyMs / 1000) }) },
      { label: t('goal.est.leader'), value: `${p.leader.model} · ${fmt.usd(p.leader.costUsd)}` },
    ],
    tasks: p.tasks.map((task) => ({
      key: task.identityId, name: task.name, handle: task.handle, instr: task.instruction,
      signals: SIGNAL_ORDER.map((k) => task.signals?.[k] ?? false), ready: task.ready, readyLabel: readyLabelText(task.readyLabel, i18n),
    })),
    leaderWarning: p.leader.error ? t('goal.plan.leaderWarning', { error: p.leader.error }) : null,
    source: { kind: 'live', plan: p },
  };
}

export function selectDemoPlanVM(tiles: readonly TileVM[], fleetSize: number, i18n: I18n = PT): PlanVM {
  return {
    patternLabel: patternLabel('fan-out', i18n),
    rationale: i18n.t('goal.demo.rationale'),
    estimate: selectEstimate(tiles, fleetSize, i18n),
    tasks: selectPlanTasks(tiles, i18n).map((task) => ({
      key: task.name, name: task.name, handle: task.handle, instr: task.instr,
      signals: SIGNAL_ORDER.map((_, k) => k < task.signalsOk), ready: task.signalsOk === 5, readyLabel: task.readyLabel,
    })),
    leaderWarning: null,
    source: { kind: 'demo', tiles, fleetSize },
  };
}

/** O mesmo plano em outro idioma (a tela chama com o idioma atual). */
export function localizePlanVM(vm: PlanVM, i18n: I18n): PlanVM {
  const s = vm.source;
  return s.kind === 'live' ? selectPlanVM(s.plan, i18n) : selectDemoPlanVM(s.tiles, s.fleetSize, i18n);
}
