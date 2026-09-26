import { PT, type I18n } from '../i18n/translate';
import type { PastGoal } from '../types/fleet';

/** Objetivo do cockpit demo. */
export const currentGoalText = (i18n: I18n = PT): string => i18n.t('goal.demo.current');
/** Objetivo usado quando o composer está vazio. */
export const defaultGoalText = (i18n: I18n = PT): string => i18n.t('goal.demo.default');

export const CURRENT_GOAL_TEXT = currentGoalText();
export const DEFAULT_GOAL_TEXT = defaultGoalText();

export interface GoalExample { readonly label: string; readonly text: string }

/** Atalhos do composer: rótulo do botão e o objetivo completo que ele preenche. */
export function goalExamples(i18n: I18n = PT): readonly GoalExample[] {
  const labels = [i18n.t('goal.examples.replies'), i18n.t('goal.examples.likes'), i18n.t('goal.examples.dms')];
  return labels.map((label) => ({ label, text: i18n.t('goal.examples.everyAccount', { label }) }));
}

/** Instrução de cada tarefa do plano demo. */
export const taskInstruction = (i18n: I18n = PT): string => i18n.t('goal.demo.instruction');

/** Histórico do modo demo. */
export function demoPastGoals(i18n: I18n = PT): readonly PastGoal[] {
  const { t, fmt } = i18n;
  return [
    { text: t('report.demo.past1.text'), pattern: 'fan-out', result: t('report.demo.past1.result'), cost: fmt.usd(4.1) },
    { text: t('report.demo.past2.text'), pattern: 'fan-out', result: t('report.demo.past2.result'), cost: fmt.usd(2.85) },
    { text: t('report.demo.past3.text'), pattern: 'sharding', result: '300/300', cost: fmt.usd(6.02) },
  ];
}

export const PAST_GOALS: readonly PastGoal[] = demoPastGoals();

interface PastRowLike { readonly key: string; readonly text: string; readonly result: string; readonly cost: string }

/**
 * Linha do histórico no idioma da tela. As do demo chegam montadas em português com `key` = texto em português;
 * as do daemon (`key` = id do objetivo) passam como vieram.
 */
export function localizePastRow<R extends PastRowLike>(row: R, i18n: I18n): R {
  const k = PAST_GOALS.findIndex((g) => g.text === row.key);
  if (k < 0) return row;
  const g = demoPastGoals(i18n)[k];
  return { ...row, text: g.text, result: g.result, cost: g.cost };
}
