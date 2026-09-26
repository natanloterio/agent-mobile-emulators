import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { DEFAULT_GOAL_TEXT } from '../data/goals';
import type { ProviderMode, RoleKey, Screen } from '../types/fleet';
import { createInitialState, fleetReducer, type FleetState } from './fleetReducer';

const TICK_MS = 2600;
const DECOMPOSE_MS = 1200;
const TEST_MS = 1400;
const SCREENS: readonly Screen[] = ['cockpit', 'device', 'new', 'report', 'ids', 'prov'];

/** O bridge lança `Error('/providers/x → 409: {"error":"…"}')`; a tela mostra só a linha legível. */
const bridgeMessage = (e: Error) => e.message.replace(/^.*→ \d+: /, '').replace(/^\{"error":"|"\}$/g, '');

/** `?screen=report` abre direto numa tela. Valor desconhecido cai no cockpit. */
function initialScreenFromUrl(): Screen {
  const q = new URLSearchParams(window.location.search).get('screen') ?? '';
  return (SCREENS as readonly string[]).includes(q) ? (q as Screen) : 'cockpit';
}

export interface FleetActions {
  readonly go: (screen: Screen) => void;
  readonly openDevice: (index: number) => void;
  readonly kill: () => void;
  readonly resume: () => void;
  readonly toggleControl: () => void;
  readonly togglePause: () => void;
  readonly resolveSelected: () => void;
  readonly setGoal: (text: string) => void;
  readonly decompose: () => void;
  readonly resetPlan: () => void;
  readonly launch: (fleetSize: number) => void;
  readonly pickMode: (role: RoleKey, mode: ProviderMode) => void;
  readonly testConnection: (role: RoleKey) => void;
  readonly setProviderField: (role: RoleKey, patch: { model?: string; endpoint?: string }) => void;
  readonly loadProviderModels: (role: RoleKey) => void;
  readonly provision: () => void;
  readonly extraAction: (index: number) => void;
}

export interface UseFleet {
  readonly state: FleetState;
  readonly actions: FleetActions;
}

/** Estado da frota com os efeitos temporais do design: tick, decomposição e teste de provedor. */
export function useFleet(): UseFleet {
  const [state, dispatch] = useReducer(fleetReducer, initialScreenFromUrl(), createInitialState);

  useEffect(() => {
    const id = window.setInterval(() => dispatch({ type: 'tick' }), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (state.planStage !== 1) return;
    const id = window.setTimeout(() => dispatch({ type: 'decomposeReady' }), DECOMPOSE_MS);
    return () => window.clearTimeout(id);
  }, [state.planStage]);

  const runningTests = (Object.keys(state.tests) as RoleKey[]).filter((k) => state.tests[k] === 'run');
  const runningKey = runningTests.join(',');
  useEffect(() => {
    if (!runningKey || window.enxame?.testProvider) return;
    const timers = runningKey
      .split(',')
      .map((role) => window.setTimeout(() => dispatch({ type: 'testDone', role: role as RoleKey }), TEST_MS));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [runningKey]);

  // Sem bridge (Vite no browser) não há lista real: o seletor oferece só o modelo atual.
  const loadProviderModels = useCallback((role: RoleKey) => {
    const get = window.enxame?.getProviderModels; if (!get) return;
    get(role).then((r) => {
      dispatch({ type: 'providerModels', role, models: r.models });
      if (r.error) dispatch({ type: 'providerError', role, message: r.error });
    }).catch(() => undefined);
  }, []);

  const actions = useMemo<FleetActions>(
    () => ({
      go: (screen) => dispatch({ type: 'go', screen }),
      openDevice: (index) => dispatch({ type: 'openDevice', index }),
      kill: () => dispatch({ type: 'kill' }),
      resume: () => dispatch({ type: 'resume' }),
      toggleControl: () => dispatch({ type: 'toggleControl' }),
      togglePause: () => dispatch({ type: 'togglePause' }),
      resolveSelected: () => dispatch({ type: 'resolveSelected' }),
      setGoal: (text) => dispatch({ type: 'setGoal', text }),
      decompose: () => dispatch({ type: 'decomposeStart', fallbackText: DEFAULT_GOAL_TEXT }),
      resetPlan: () => dispatch({ type: 'resetPlan' }),
      launch: (fleetSize) => dispatch({ type: 'launch', fleetSize }),
      // Com daemon: persiste no registro e o teste é real; sem daemon (Vite no browser) segue o mock com timer.
      pickMode: (role, mode) => {
        const set = window.enxame?.setProvider;
        if (!set) { dispatch({ type: 'pickMode', role, mode }); return; }
        // 409 (frota ocupada) ou 400 não mudam o modo: o erro aparece no card do papel.
        set(role, { mode }).then(() => {
          dispatch({ type: 'pickMode', role, mode });
          dispatch({ type: 'providerError', role, message: null });
          loadProviderModels(role);
        }).catch((e: Error) => dispatch({ type: 'providerError', role, message: bridgeMessage(e) }));
      },
      setProviderField: (role, patch) => {
        const set = window.enxame?.setProvider; if (!set) return;
        set(role, patch)
          .then(() => dispatch({ type: 'providerError', role, message: null }))
          .catch((e: Error) => dispatch({ type: 'providerError', role, message: bridgeMessage(e) }));
      },
      loadProviderModels,
      testConnection: (role) => {
        dispatch({ type: 'testStart', role });
        const test = window.enxame?.testProvider;
        if (!test) return;
        test(role).catch(() => undefined).finally(() => dispatch({ type: 'testDone', role }));
      },
      provision: () => dispatch({ type: 'provision' }),
      extraAction: (index) => dispatch({ type: 'extraAction', index }),
    }),
    [loadProviderModels],
  );

  return { state, actions };
}
