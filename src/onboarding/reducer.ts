import { LOCAL_MODELS, type SetupMode } from './catalog';
import type { JobEvent, JobId, KeyTestResult, SetupReport } from './schema';
import { defaultMode, defaultModel, modelFit } from './view';

export type Step = 0 | 1 | 2 | 3;
export interface OnboardingState {
  readonly step: Step;
  readonly report: SetupReport | null; readonly checking: boolean; readonly checkError: string | null;
  readonly mode: SetupMode; readonly modeTouched: boolean;
  readonly model: string; readonly modelTouched: boolean;
  readonly apiKey: string; readonly keyTest: 'idle' | 'busy' | KeyTestResult;
  readonly jobs: Readonly<Partial<Record<JobId, JobEvent>>>;
  readonly installing: boolean; readonly installError: string | null;
  readonly finishing: boolean; readonly finishError: string | null;
  readonly log: readonly string[];
}
export type OnboardingAction =
  | { readonly type: 'check-start' } | { readonly type: 'check-done'; readonly report: SetupReport } | { readonly type: 'check-failed'; readonly error: string }
  | { readonly type: 'go'; readonly step: Step }
  | { readonly type: 'pick-mode'; readonly mode: SetupMode } | { readonly type: 'pick-model'; readonly model: string }
  | { readonly type: 'set-key'; readonly key: string }
  | { readonly type: 'key-test-start' } | { readonly type: 'key-test-done'; readonly result: KeyTestResult }
  | { readonly type: 'install-start' } | { readonly type: 'install-failed'; readonly error: string } | { readonly type: 'install-end' }
  | { readonly type: 'job'; readonly event: JobEvent } | { readonly type: 'log'; readonly line: string }
  | { readonly type: 'finish-start' } | { readonly type: 'finish-failed'; readonly error: string } | { readonly type: 'finish-done' };

const MAX_LOG = 200;

export const INITIAL_STATE: OnboardingState = {
  step: 0, report: null, checking: false, checkError: null,
  mode: 'misto', modeTouched: false, model: 'gpt-oss:20b', modelTouched: false,
  apiKey: '', keyTest: 'idle', jobs: {}, installing: false, installError: null,
  finishing: false, finishError: null, log: [],
};

export function onboardingReducer(s: OnboardingState, a: OnboardingAction): OnboardingState {
  switch (a.type) {
    case 'check-start': return { ...s, checking: true, checkError: null };
    case 'check-failed': return { ...s, checking: false, checkError: a.error };
    case 'check-done': {
      const { gpu, diskFreeGiB } = a.report.hardware;
      return {
        ...s, checking: false, checkError: null, report: a.report,
        mode: s.modeTouched ? s.mode : defaultMode(gpu, diskFreeGiB),
        model: s.modelTouched ? s.model : defaultModel(gpu, diskFreeGiB),
      };
    }
    // Erro do fim é do fim: voltar de passo ou instalar de novo começa sem ele.
    case 'go': return { ...s, step: a.step, finishError: null };
    case 'pick-mode': return { ...s, mode: a.mode, modeTouched: true };
    case 'pick-model': {
      const entry = LOCAL_MODELS.find((m) => m.id === a.model);
      if (!entry || (s.report && modelFit(entry, s.report.hardware.gpu) === 'too-big')) return s;
      return { ...s, model: a.model, modelTouched: true };
    }
    case 'set-key': return { ...s, apiKey: a.key, keyTest: 'idle' };
    case 'key-test-start': return { ...s, keyTest: 'busy' };
    case 'key-test-done': return { ...s, keyTest: a.result };
    case 'install-start': return { ...s, installing: true, installError: null, finishError: null };
    case 'install-failed': return { ...s, installError: a.error };
    case 'install-end': return { ...s, installing: false };
    case 'job': return { ...s, jobs: { ...s.jobs, [a.event.id]: a.event } };
    case 'log': return { ...s, log: [...s.log, a.line].slice(-MAX_LOG) };
    case 'finish-start': return { ...s, finishing: true, finishError: null };
    case 'finish-failed': return { ...s, finishing: false, finishError: a.error };
    case 'finish-done': return { ...s, finishing: false, step: 3 };
  }
}
