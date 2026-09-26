import type { GoalPlan, GoalSummary } from '../live/types';
import { track, type ApiDeps } from './apiRequest';

export interface GoalActions {
  readonly decompose: (text: string) => Promise<void>;
  readonly launch: (plan: GoalPlan) => Promise<void>;
  readonly loadGoals: () => Promise<void>;
  readonly resume: () => Promise<void>;
  readonly kill: () => Promise<void>;
}

const MIN_GOAL_CHARS = 3; // o daemon recusa menos que isso (zod em /goals)

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

/** Checagem mínima do `GoalPlan` (spec §3.3) antes de a tela confiar nele. */
export function parseGoalPlan(x: unknown): GoalPlan {
  const ok = isObj(x) && typeof x.text === 'string' && typeof x.pattern === 'string' && Array.isArray(x.tasks)
    && isObj(x.estimate) && isObj(x.leader);
  if (!ok) throw new Error('resposta do daemon fora do contrato (plano)');
  return x as unknown as GoalPlan;
}

export function parseGoals(x: unknown): readonly GoalSummary[] {
  if (!isObj(x) || !Array.isArray(x.goals)) throw new Error('resposta do daemon fora do contrato (objetivos)');
  return x.goals as GoalSummary[];
}

/** Novo objetivo, relatório e kill switch no modo vivo (spec inc. 5 §3.2). */
export function createGoalActions(deps: ApiDeps): GoalActions {
  const { dispatch } = deps;
  return {
    decompose: async (raw) => {
      const text = raw.trim();
      if (text.length < MIN_GOAL_CHARS) {
        dispatch({ type: 'requestError', key: 'plan', message: `descreva o objetivo (mínimo ${MIN_GOAL_CHARS} caracteres)` });
        return;
      }
      dispatch({ type: 'decomposeStart', fallbackText: text });
      const r = await track(deps, 'plan', (b) => b.api?.('POST', '/goals/plan', { text }).then(parseGoalPlan));
      dispatch(r.ok ? { type: 'planReady', plan: r.value } : { type: 'planFailed' });
    },
    launch: async (plan) => {
      const r = await track(deps, 'launch', (b) => b.api?.('POST', '/goals', { text: plan.text, plan }));
      if (r.ok) dispatch({ type: 'launched' });
    },
    loadGoals: async () => {
      const r = await track(deps, 'goals', (b) => b.api?.('GET', '/goals').then(parseGoals));
      if (r.ok) dispatch({ type: 'goalsLoaded', goals: r.value });
    },
    resume: async () => { await track(deps, 'resume', (b) => b.resume?.()); },
    kill: async () => { await track(deps, 'kill', (b) => b.kill?.()); },
  };
}
