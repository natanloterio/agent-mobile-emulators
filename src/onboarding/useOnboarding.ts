import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { SetupBridge } from '../live/types';
import { INITIAL_STATE, onboardingReducer, type OnboardingState, type Step } from './reducer';
import { JobEventSchema, KeyTestSchema, SetupReportSchema } from './schema';
import { depRows, ipcErrorText, jobsToInstall, shouldApplyRoles } from './view';

export interface OnboardingActions {
  readonly check: () => Promise<void>;
  readonly go: (step: Step) => void;
  readonly next: () => void;
  readonly pickMode: (mode: OnboardingState['mode']) => void;
  readonly pickModel: (model: string) => void;
  readonly setKey: (key: string) => void;
  readonly testKey: () => Promise<void>;
  readonly install: () => Promise<void>;
}

/** `firstRun` false = reaberto em Provedores: os papéis só mudam se a pessoa mexer em modo ou modelo. */
export function useOnboarding(bridge: SetupBridge, firstRun: boolean): { state: OnboardingState; actions: OnboardingActions } {
  const [state, dispatch] = useReducer(onboardingReducer, INITIAL_STATE);
  const ref = useRef(state);
  ref.current = state;

  const check = useCallback(async () => {
    dispatch({ type: 'check-start' });
    try { dispatch({ type: 'check-done', report: SetupReportSchema.parse(await bridge.check()) }); }
    catch (e) { dispatch({ type: 'check-failed', error: ipcErrorText(e) }); }
  }, [bridge]);

  useEffect(() => { void check(); }, [check]);
  useEffect(() => {
    const offJob = bridge.onJob((raw) => { const p = JobEventSchema.safeParse(raw); if (p.success) dispatch({ type: 'job', event: p.data }); });
    const offLog = bridge.onLog((line) => dispatch({ type: 'log', line }));
    return () => { offJob(); offLog(); };
  }, [bridge]);

  const install = useCallback(async () => {
    const s = ref.current;
    if (!s.report || s.installing) return;
    const jobs = jobsToInstall(depRows(s.report, s.mode, s.model)).filter((id) => s.jobs[id]?.state !== 'done');
    dispatch({ type: 'install-start' });
    try { await bridge.install({ jobs, localModel: s.model }); }
    catch (e) { dispatch({ type: 'install-failed', error: ipcErrorText(e) }); }
    finally { dispatch({ type: 'install-end' }); }
  }, [bridge]);

  const finish = useCallback(async () => {
    const s = ref.current;
    dispatch({ type: 'finish-start' });
    const key = s.mode === 'local' ? '' : s.apiKey.trim();
    try {
      await bridge.finish({ mode: s.mode, localModel: s.model, anthropicKey: key || null, applyRoles: shouldApplyRoles(firstRun, s) });
      dispatch({ type: 'finish-done' });
    } catch (e) { dispatch({ type: 'finish-failed', error: ipcErrorText(e) }); }
  }, [bridge, firstRun]);

  const go = useCallback((step: Step) => {
    dispatch({ type: 'go', step });
    if (step === 2) void install();
  }, [install]);

  const next = useCallback(() => {
    const s = ref.current.step;
    if (s === 2) void finish();
    else if (s < 2) go((s + 1) as Step);
  }, [finish, go]);

  const testKey = useCallback(async () => {
    dispatch({ type: 'key-test-start' });
    try { dispatch({ type: 'key-test-done', result: KeyTestSchema.parse(await bridge.testKey(ref.current.apiKey.trim())).result }); }
    catch { dispatch({ type: 'key-test-done', result: 'invalid' }); }
  }, [bridge]);

  return {
    state,
    actions: {
      check, go, next, install, testKey,
      pickMode: (mode) => dispatch({ type: 'pick-mode', mode }),
      pickModel: (model) => dispatch({ type: 'pick-model', model }),
      setKey: (key) => dispatch({ type: 'set-key', key }),
    },
  };
}
