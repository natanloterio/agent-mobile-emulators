import { createI18n } from '../i18n/translate';
import type { Locale } from '../i18n/locales';
import { documentLocale } from './goalActions';
import { track, type ApiDeps } from './apiRequest';

export const MISSION_START_KEY = 'missionStart';
export const missionKey = (id: string): string => `mission:${id}`;
export type MissionAction = 'pause' | 'resume' | 'continue' | 'abandon';
export type MissionInstructThen = 'continue' | 'resume';
export interface MissionActions {
  readonly start: (identityId: string, text: string) => Promise<boolean>;
  readonly act: (id: string, action: MissionAction, text?: string) => Promise<void>;
  /** Instrução do operador (spec instruções): texto aparado; vazio não chama o daemon. */
  readonly instruct: (id: string, text: string, then?: MissionInstructThen) => Promise<boolean>;
}

const MIN_CHARS = 3; // o daemon recusa menos que isso (GoalText)

/** Missões no modo vivo (spec missões §API): iniciar e as quatro transições. */
export function createMissionActions(deps: ApiDeps & { readonly confirm: (m: string) => boolean; readonly getLocale?: () => Locale }): MissionActions {
  const locale = () => (deps.getLocale ?? documentLocale)();
  return {
    start: async (identityId, raw) => {
      const text = raw.trim();
      const i18n = createI18n(locale());
      if (text.length < MIN_CHARS) { deps.dispatch({ type: 'requestError', key: MISSION_START_KEY, message: i18n.t('goal.error.tooShort', { min: MIN_CHARS }) }); return false; }
      const r = await track(deps, MISSION_START_KEY, (b) => b.api?.('POST', '/missions', { identityId, text, lang: i18n.locale }));
      return r.ok;
    },
    act: async (id, action, text) => {
      if (action === 'abandon' && !deps.confirm(createI18n(locale()).t('mission.confirm.abandon', { text: text ?? '' }))) return;
      await track(deps, missionKey(id), (b) => b.api?.('POST', `/missions/${encodeURIComponent(id)}/${action}`));
    },
    instruct: async (id, raw, then) => {
      const text = raw.trim();
      if (!text) return false;
      const r = await track(deps, missionKey(id), (b) => b.api?.('POST', `/missions/${encodeURIComponent(id)}/instruct`, then ? { text, then } : { text }));
      return r.ok;
    },
  };
}
