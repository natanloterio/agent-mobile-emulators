import { EXTRA_IDENTITIES, IDENTITIES } from '../data/identities';
import { DEFAULT_MODES } from '../data/providers';
import type {
  ExtraIdentity, Identity, PlanStage, ProviderMode, RoleKey, Screen, TestStage,
} from '../types/fleet';

export interface FleetState {
  readonly screen: Screen;
  readonly sel: number;
  readonly ids: readonly Identity[];
  readonly extra: readonly ExtraIdentity[];
  readonly killed: boolean;
  readonly control: boolean;
  readonly goalText: string;
  readonly planStage: PlanStage;
  readonly tests: Readonly<Record<RoleKey, TestStage>>;
  readonly modes: Readonly<Record<RoleKey, ProviderMode>>;
  readonly tick: number;
  /** Erro do último PUT (400/409) por papel. */
  readonly providerErrors: Partial<Record<RoleKey, string>>;
  /** Erro da última carga da lista de modelos (ex.: "Ollama parado"); separado para um PUT não apagá-lo. */
  readonly providerModelsErrors: Partial<Record<RoleKey, string>>;
  readonly providerModels: Partial<Record<RoleKey, readonly string[]>>;
}

export type FleetAction =
  | { type: 'go'; screen: Screen }
  | { type: 'openDevice'; index: number }
  | { type: 'tick' }
  | { type: 'kill' }
  | { type: 'resume' }
  | { type: 'toggleControl' }
  | { type: 'togglePause' }
  | { type: 'resolveSelected' }
  | { type: 'setGoal'; text: string }
  | { type: 'decomposeStart'; fallbackText: string }
  | { type: 'decomposeReady' }
  | { type: 'resetPlan' }
  | { type: 'launch'; fleetSize: number }
  | { type: 'pickMode'; role: RoleKey; mode: ProviderMode }
  | { type: 'testStart'; role: RoleKey }
  | { type: 'testDone'; role: RoleKey }
  | { type: 'providerError'; role: RoleKey; message: string | null }
  | { type: 'providerModels'; role: RoleKey; models: readonly string[] }
  | { type: 'providerModelsError'; role: RoleKey; message: string | null }
  | { type: 'provision' }
  | { type: 'extraAction'; index: number };

export function createInitialState(screen: Screen = 'cockpit'): FleetState {
  return {
  screen,
  sel: 0,
  ids: IDENTITIES,
  extra: EXTRA_IDENTITIES,
  killed: false,
  control: false,
  goalText: '',
  planStage: 0,
  tests: { lider: null, worker: null, esc: null },
  modes: DEFAULT_MODES,
  tick: 0,
  providerErrors: {},
  providerModelsErrors: {},
  providerModels: {},
  };
}

export const initialFleetState: FleetState = createInitialState();

const STEP_COST = 0.012;

function updateAt<T>(list: readonly T[], index: number, patch: (item: T) => T): readonly T[] {
  return list.map((item, i) => (i === index ? patch(item) : item));
}

function advanceRunning(ids: readonly Identity[]): readonly Identity[] {
  return ids.map((d) =>
    d.state === 'running' && d.steps < d.budget
      ? { ...d, steps: d.steps + 1, cost: d.cost + STEP_COST }
      : d,
  );
}

function launchIdle(ids: readonly Identity[], fleetSize: number): readonly Identity[] {
  return ids.map((d, i) =>
    i < fleetSize && d.state === 'idle'
      ? { ...d, state: 'running', steps: 0, cost: 0, task: 'Respondendo comentários' }
      : d,
  );
}

function newProvisionedIdentity(extraCount: number): ExtraIdentity {
  const slot = 10 + extraCount;
  return {
    name: `conta${11 + extraCount}`,
    handle: 'sem conta',
    lc: 'blank',
    app: 'Instagram',
    version: '—',
    snap: '—',
    disk: '3,4 / 8 GB',
    diskPct: 42,
    ports: `${5554 + slot * 2} · ${8080 + slot}`,
    action: 'Fazer login',
  };
}

function applyExtraAction(e: ExtraIdentity): ExtraIdentity {
  if (e.lc === 'banned') return { ...e, disk: '0 GB · AVD descartado', diskPct: 0, action: '' };
  return { ...e, lc: 'logged-in', handle: '@loja.sul', snap: 'agora', action: '' };
}

function withRoleMessage(
  errors: Partial<Record<RoleKey, string>>, role: RoleKey, message: string | null,
): Partial<Record<RoleKey, string>> {
  const { [role]: _drop, ...rest } = errors;
  return message ? { ...rest, [role]: message } : rest;
}

export function fleetReducer(s: FleetState, a: FleetAction): FleetState {
  switch (a.type) {
    case 'go':
      return { ...s, screen: a.screen };
    case 'openDevice':
      return { ...s, screen: 'device', sel: a.index, control: false };
    case 'tick':
      return s.killed ? s : { ...s, tick: s.tick + 1, ids: advanceRunning(s.ids) };
    case 'kill':
      return { ...s, killed: true };
    case 'resume':
      return { ...s, killed: false };
    case 'toggleControl':
      return { ...s, control: !s.control };
    case 'togglePause':
      return {
        ...s,
        ids: updateAt(s.ids, s.sel, (d) => ({ ...d, state: d.state === 'idle' ? 'running' : 'idle' })),
      };
    case 'resolveSelected':
      return {
        ...s,
        ids: updateAt(s.ids, s.sel, (d) => ({ ...d, state: 'running', error: '', task: 'Respondendo comentários' })),
      };
    case 'setGoal':
      return { ...s, goalText: a.text, planStage: 0 };
    case 'decomposeStart':
      return { ...s, goalText: s.goalText || a.fallbackText, planStage: 1 };
    case 'decomposeReady':
      return s.planStage === 1 ? { ...s, planStage: 2 } : s;
    case 'resetPlan':
      return { ...s, planStage: 0 };
    case 'launch':
      return { ...s, screen: 'cockpit', planStage: 0, killed: false, ids: launchIdle(s.ids, a.fleetSize) };
    case 'pickMode':
      return { ...s, modes: { ...s.modes, [a.role]: a.mode }, tests: { ...s.tests, [a.role]: null } };
    case 'testStart':
      return { ...s, tests: { ...s.tests, [a.role]: 'run' } };
    case 'testDone':
      return s.tests[a.role] === 'run' ? { ...s, tests: { ...s.tests, [a.role]: 'done' } } : s;
    case 'providerError':
      return { ...s, providerErrors: withRoleMessage(s.providerErrors, a.role, a.message) };
    case 'providerModelsError':
      return { ...s, providerModelsErrors: withRoleMessage(s.providerModelsErrors, a.role, a.message) };
    case 'providerModels':
      return { ...s, providerModels: { ...s.providerModels, [a.role]: a.models } };
    case 'provision':
      return { ...s, extra: [...s.extra, newProvisionedIdentity(s.extra.length)] };
    case 'extraAction':
      return { ...s, extra: updateAt(s.extra, a.index, applyExtraAction) };
  }
}
