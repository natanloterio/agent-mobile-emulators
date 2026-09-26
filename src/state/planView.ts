import { usd } from '../lib/format';
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
export interface PlanVM {
  readonly patternLabel: string;
  readonly rationale: string;
  readonly estimate: readonly Stat[];
  readonly tasks: readonly PlanTaskVM[];
  /** Líder caiu e o plano saiu da regra determinística. */
  readonly leaderWarning: string | null;
}

const PATTERN_LABEL: Readonly<Record<string, string>> = { 'fan-out': 'Fan-out replicado', sharding: 'Sharding' };
const DEMO_RATIONALE = 'O trabalho pertence à conta: cada identidade responde a própria caixa. Uma tarefa por identidade.';

export function selectPlanVM(p: GoalPlan): PlanVM {
  return {
    patternLabel: PATTERN_LABEL[p.pattern] ?? p.pattern,
    rationale: p.rationale,
    estimate: [
      { label: 'Tarefas prontas', value: String(p.estimate.tasks) },
      { label: 'Fora da sonda', value: String(p.estimate.outOfProbe) },
      { label: 'Orçamento de passos', value: `${p.estimate.stepBudget} por conta` },
      { label: 'Frota pronta em', value: `~${Math.ceil(p.estimate.fleetReadyMs / 1000)} s · starts escalonados` },
      { label: 'Líder', value: `${p.leader.model} · ${usd(p.leader.costUsd)}` },
    ],
    tasks: p.tasks.map((t) => ({
      key: t.identityId, name: t.name, handle: t.handle, instr: t.instruction,
      signals: SIGNAL_ORDER.map((k) => t.signals?.[k] ?? false), ready: t.ready, readyLabel: t.readyLabel,
    })),
    leaderWarning: p.leader.error ? `Líder indisponível, regra determinística (${p.leader.error})` : null,
  };
}

export function selectDemoPlanVM(tiles: readonly TileVM[], fleetSize: number): PlanVM {
  return {
    patternLabel: PATTERN_LABEL['fan-out'],
    rationale: DEMO_RATIONALE,
    estimate: selectEstimate(tiles, fleetSize),
    tasks: selectPlanTasks(tiles).map((t) => ({
      key: t.name, name: t.name, handle: t.handle, instr: t.instr,
      signals: SIGNAL_ORDER.map((_, k) => k < t.signalsOk), ready: t.signalsOk === 5, readyLabel: t.readyLabel,
    })),
    leaderWarning: null,
  };
}
