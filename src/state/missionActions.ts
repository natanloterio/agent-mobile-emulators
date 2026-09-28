import { createI18n } from '../i18n/translate';
import type { Locale } from '../i18n/locales';
import { documentLocale } from './goalActions';
import { track, type ApiDeps } from './apiRequest';

export const MISSION_START_KEY = 'missionStart';
export const missionKey = (id: string): string => `mission:${id}`;
export type MissionAction = 'pause' | 'resume' | 'continue' | 'abandon';
export type MissionInstructThen = 'continue' | 'resume';
export interface MissionActions {
  /** A mesma missão em cada identidade (uma missão por device). true só se todas iniciaram. */
  readonly start: (identityIds: readonly string[], text: string) => Promise<boolean>;
  /** Sequência com arquivo (spec arquivos): uma etapa por identidade, na ordem; o arquivo de uma vai para a seguinte. */
  readonly startChain: (steps: readonly ChainStepInput[]) => Promise<boolean>;
  readonly act: (id: string, action: MissionAction, text?: string) => Promise<void>;
  /** Instrução do operador (spec instruções): texto aparado; vazio não chama o daemon. */
  readonly instruct: (id: string, text: string, then?: MissionInstructThen) => Promise<boolean>;
}

const MIN_CHARS = 3; // o daemon recusa menos que isso (GoalText)
export interface ChainStepInput { readonly identityId: string; readonly text: string }

interface StartReply { readonly started: readonly { identityId: string }[]; readonly failed: readonly { identityId: string; error: string }[] }
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

/** Resposta de `POST /missions` com `identityIds`; forma inesperada vira "nada falhou" (o daemon já respondeu 201). */
function parseStartReply(x: unknown): StartReply {
  const list = (v: unknown) => (Array.isArray(v) ? v.filter(isObj) : []);
  const failed = list(isObj(x) ? x.failed : null).map((f) => ({ identityId: String(f.identityId), error: String(f.error) }));
  const started = list(isObj(x) ? x.started : null).map((s) => ({ identityId: String(s.identityId) }));
  return { started, failed };
}

/** Missões no modo vivo (spec missões §API): iniciar e as quatro transições. */
export function createMissionActions(deps: ApiDeps & { readonly confirm: (m: string) => boolean; readonly getLocale?: () => Locale }): MissionActions {
  const locale = () => (deps.getLocale ?? documentLocale)();
  return {
    start: async (identityIds, raw) => {
      const text = raw.trim();
      const i18n = createI18n(locale());
      if (identityIds.length === 0) return false;
      if (text.length < MIN_CHARS) { deps.dispatch({ type: 'requestError', key: MISSION_START_KEY, message: i18n.t('goal.error.tooShort', { min: MIN_CHARS }) }); return false; }
      const r = await track(deps, MISSION_START_KEY, (b) => b.api?.('POST', '/missions', { identityIds, text, lang: i18n.locale }));
      if (!r.ok) return false;
      const { started, failed } = parseStartReply(r.value);
      if (failed.length === 0) return true;
      deps.dispatch({ type: 'requestError', key: MISSION_START_KEY, message: i18n.t('mission.partialFailed', {
        started: started.map((s) => s.identityId).join(', '),
        failed: failed.map((f) => `${f.identityId} (${f.error})`).join(', '),
      }) });
      return false;
    },
    startChain: async (raw) => {
      const i18n = createI18n(locale());
      const steps = raw.map((s) => ({ identityId: s.identityId, text: s.text.trim() }));
      if (steps.length < 2 || steps.some((s) => !s.identityId)) { deps.dispatch({ type: 'requestError', key: MISSION_START_KEY, message: i18n.t('mission.chain.needTwo') }); return false; }
      if (steps.some((s) => s.text.length < MIN_CHARS)) { deps.dispatch({ type: 'requestError', key: MISSION_START_KEY, message: i18n.t('goal.error.tooShort', { min: MIN_CHARS }) }); return false; }
      const r = await track(deps, MISSION_START_KEY, (b) => b.api?.('POST', '/missions/chain', { steps, lang: i18n.locale }));
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
