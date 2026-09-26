import { DEFAULT_GOAL_TEXT, defaultGoalText } from '../data/goals';
import { DEFAULT_LOCALE, detectLocale, type Locale } from '../i18n/locales';
import { createI18n, PT, type I18n } from '../i18n/translate';
import type { GoalPlan, GoalSummary } from '../live/types';
import { track, type ApiDeps } from './apiRequest';

export interface GoalActions {
  readonly decompose: (text: string) => Promise<void>;
  readonly launch: (plan: GoalPlan) => Promise<void>;
  readonly loadGoals: () => Promise<void>;
  readonly resume: () => Promise<void>;
  readonly kill: () => Promise<void>;
}

export interface GoalActionDeps extends ApiDeps {
  /** Idioma atual da interface (o líder responde nele). Padrão: o `lang` do documento, que o I18nProvider mantém. */
  readonly getLocale?: () => Locale;
}

const MIN_GOAL_CHARS = 3; // o daemon recusa menos que isso (zod em /goals)

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

/** Idioma do documento (`pt-BR` → pt); fora do navegador, português. */
export function documentLocale(): Locale {
  const tag = typeof document === 'undefined' ? '' : document.documentElement.lang;
  return tag ? detectLocale([tag]) : DEFAULT_LOCALE;
}

/** Checagem mínima do `GoalPlan` (spec §3.3) antes de a tela confiar nele. */
export function parseGoalPlan(x: unknown, i18n: I18n = PT): GoalPlan {
  const ok = isObj(x) && typeof x.text === 'string' && typeof x.pattern === 'string' && Array.isArray(x.tasks)
    && isObj(x.estimate) && isObj(x.leader);
  if (!ok) throw new Error(i18n.t('goal.error.badPlan'));
  return x as unknown as GoalPlan;
}

export function parseGoals(x: unknown, i18n: I18n = PT): readonly GoalSummary[] {
  if (!isObj(x) || !Array.isArray(x.goals)) throw new Error(i18n.t('goal.error.badGoals'));
  return x.goals as GoalSummary[];
}

/** Novo objetivo, relatório e kill switch no modo vivo (spec inc. 5 §3.2). */
export function createGoalActions(deps: GoalActionDeps): GoalActions {
  const { dispatch } = deps;
  const i18nNow = () => createI18n((deps.getLocale ?? documentLocale)());
  return {
    decompose: async (raw) => {
      const i18n = i18nNow();
      const trimmed = raw.trim();
      // Composer vazio: quem chama manda o objetivo padrão em português; vai no idioma da tela.
      const text = trimmed === DEFAULT_GOAL_TEXT ? defaultGoalText(i18n) : trimmed;
      if (text.length < MIN_GOAL_CHARS) {
        dispatch({ type: 'requestError', key: 'plan', message: i18n.t('goal.error.tooShort', { min: MIN_GOAL_CHARS }) });
        return;
      }
      dispatch({ type: 'decomposeStart', fallbackText: text });
      const r = await track(deps, 'plan', (b) => b.api?.('POST', '/goals/plan', { text, lang: i18n.locale }).then((x) => parseGoalPlan(x, i18n)));
      dispatch(r.ok ? { type: 'planReady', plan: r.value } : { type: 'planFailed' });
    },
    launch: async (plan) => {
      const r = await track(deps, 'launch', (b) => b.api?.('POST', '/goals', { text: plan.text, plan }));
      if (r.ok) dispatch({ type: 'launched' });
    },
    loadGoals: async () => {
      const i18n = i18nNow();
      const r = await track(deps, 'goals', (b) => b.api?.('GET', '/goals').then((x) => parseGoals(x, i18n)));
      if (r.ok) dispatch({ type: 'goalsLoaded', goals: r.value });
    },
    resume: async () => { await track(deps, 'resume', (b) => b.resume?.()); },
    kill: async () => { await track(deps, 'kill', (b) => b.kill?.()); },
  };
}
