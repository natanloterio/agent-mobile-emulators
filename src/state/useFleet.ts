import { useEffect, useMemo, useReducer, useRef } from 'react';
import { DEFAULT_GOAL_TEXT } from '../data/goals';
import type { ProviderMode, RoleKey, Screen } from '../types/fleet';
import { createInitialState, fleetReducer, type FleetState } from './fleetReducer';
import { createGoalActions, type GoalActions } from './goalActions';
import { createIdentityActions, type IdentityActions } from './identityActions';
import { createProviderActions } from './providerActions';
import type { ProviderPatch } from '../live/types';
import { useI18n } from '../i18n/I18nProvider';

export { bridgeMessage } from './providerActions';

const TICK_MS = 2600;
const DECOMPOSE_MS = 1200;
const TEST_MS = 1400;
const SCREENS: readonly Screen[] = ['cockpit', 'device', 'new', 'report', 'ids', 'prov'];

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
  readonly setProviderField: (role: RoleKey, patch: Omit<ProviderPatch, 'mode'>) => void;
  readonly loadProviderModels: (role: RoleKey) => void;
  readonly provision: () => void;
  readonly extraAction: (index: number) => void;
}

export interface UseFleet {
  readonly state: FleetState;
  readonly actions: FleetActions;
  /** Modo vivo: há bridge com o canal genérico `api` (Electron). Decide dados reais × demo. */
  readonly bridged: boolean;
  /** Ações que falam com o daemon (modo vivo). */
  readonly goal: GoalActions;
  readonly identity: IdentityActions;
}

/** Bridge do preload; a presença de `api` marca o modo vivo. */
export const hasLiveBridge = (): boolean => !!window.enxame?.api;

/** Estado da frota; no demo, com os efeitos temporais do design (tick, decomposição); no vivo, nenhum tick. */
export function useFleet(): UseFleet {
  const [state, dispatch] = useReducer(fleetReducer, initialScreenFromUrl(), createInitialState);
  const bridged = useMemo(hasLiveBridge, []);

  useEffect(() => {
    if (bridged) return;
    const id = window.setInterval(() => dispatch({ type: 'tick' }), TICK_MS);
    return () => window.clearInterval(id);
  }, [bridged]);

  useEffect(() => {
    if (bridged || state.planStage !== 1) return;
    const id = window.setTimeout(() => dispatch({ type: 'decomposeReady' }), DECOMPOSE_MS);
    return () => window.clearTimeout(id);
  }, [bridged, state.planStage]);

  const runningTests = (Object.keys(state.tests) as RoleKey[]).filter((k) => state.tests[k] === 'run');
  const runningKey = runningTests.join(',');
  useEffect(() => {
    if (!runningKey || window.enxame?.testProvider) return;
    const timers = runningKey
      .split(',')
      .map((role) => window.setTimeout(() => dispatch({ type: 'testDone', role: role as RoleKey }), TEST_MS));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [runningKey]);

  // Lido pela lista mock sem daemon; atualizado no render para o efeito do Providers (filho) já ver o modo novo.
  const modesRef = useRef(state.modes);
  modesRef.current = state.modes;

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
      ...createProviderActions({ dispatch, getBridge: () => window.enxame, getMode: (role) => modesRef.current[role] }),
      provision: () => dispatch({ type: 'provision' }),
      extraAction: (index) => dispatch({ type: 'extraAction', index }),
    }),
    [],
  );

  // Idioma lido a cada chamada: as ações nascem uma vez, mas as mensagens geradas na UI seguem o seletor.
  const i18n = useI18n();
  const i18nRef = useRef(i18n);
  i18nRef.current = i18n;
  const live = useMemo(() => {
    const deps = { dispatch, getBridge: () => window.enxame, getI18n: () => i18nRef.current };
    return { goal: createGoalActions(deps), identity: createIdentityActions({ ...deps, confirm: (m: string) => window.confirm(m) }) };
  }, []);

  return { state, actions, bridged, ...live };
}
