import { DISK_PCT_BY_INDEX, LIFECYCLE_BY_NAME, RECENT_TOOLS, TARGET_APP, TARGET_APP_VERSION } from '../data/identities';
import { endpointFor, modelFor, ROLES, testResultFor, type TestResultRow } from '../data/providers';
import { TASK_INSTRUCTION } from '../data/goals';
import { ptDecimal, usd } from '../lib/format';
import type { DeviceState, Identity, Lifecycle, ProviderMode, RoleKey } from '../types/fleet';
import type { FleetState } from './fleetReducer';

export type Tone = 'green' | 'grey' | 'dark' | 'white';

export interface TileVM extends Identity {
  readonly index: number;
  readonly effState: DeviceState;
  readonly stateLabel: string;
  readonly pillTone: Tone;
  readonly pillGreenBorder: boolean;
  readonly cardTone: Tone;
  readonly costFmt: string;
  readonly app: string;
  readonly version: string;
  readonly needs: boolean;
  readonly overlay: string;
  readonly replyDraft: string;
}

const STATE_LABEL: Record<DeviceState, string> = {
  running: 'running', idle: 'idle', needs: 'needs-attention', offline: 'offline', paused: 'pausado',
};
const STATE_TONE: Record<DeviceState, Tone> = {
  running: 'green', idle: 'grey', needs: 'dark', offline: 'white', paused: 'white',
};

export const TASKS_PER_IDENTITY = 50;

export function effectiveState(d: Identity, killed: boolean): DeviceState {
  return killed && d.state === 'running' ? 'paused' : d.state;
}

export function decorateTile(d: Identity, index: number, killed: boolean): TileVM {
  const effState = effectiveState(d, killed);
  const needs = d.state === 'needs';
  return {
    ...d,
    index,
    effState,
    stateLabel: STATE_LABEL[effState],
    pillTone: STATE_TONE[effState],
    pillGreenBorder: needs,
    cardTone: needs ? 'dark' : d.state === 'running' ? 'grey' : 'white',
    costFmt: d.genMs ? `${usd(d.cost)} · ${(d.genMs / 1000).toFixed(1).replace('.', ',')} s GPU` : usd(d.cost),
    app: TARGET_APP,
    version: TARGET_APP_VERSION,
    needs,
    overlay: d.state === 'offline' ? 'Sonda: app atualizou sozinho. Device não entra na frota.' : '',
    replyDraft: d.state === 'running' ? 'Obrigada! Já te chamamos no direct' : 'Input do agente desligado',
  };
}

export function selectTiles(s: FleetState, fleetSize: number): readonly TileVM[] {
  return s.ids.slice(0, fleetSize).map((d, i) => decorateTile(d, i, s.killed));
}

export function selectSelected(tiles: readonly TileVM[], sel: number): TileVM {
  return tiles[Math.min(sel, tiles.length - 1)];
}

export interface Stat { readonly value: string; readonly label: string }

export function selectGoalStats(tiles: readonly TileVM[], fleetSize: number, showCost: boolean): readonly Stat[] {
  const running = tiles.filter((d) => d.state === 'running').length;
  const needs = tiles.filter((d) => d.state === 'needs').length;
  const total = tiles.reduce((a, d) => a + d.cost, 0);
  return [
    { value: `${running}/${fleetSize}`, label: 'identidades rodando' },
    { value: String(needs), label: 'precisam de você' },
    { value: showCost ? usd(total) : '—', label: 'custo até agora' },
  ];
}

export function selectGoalPct(tiles: readonly TileVM[]): number {
  const done = tiles.reduce((a, d) => a + d.steps, 0);
  return Math.round((done / (tiles.length * TASKS_PER_IDENTITY)) * 100);
}

export function selectNeedsCount(tiles: readonly TileVM[]): number {
  return tiles.filter((d) => d.state === 'needs').length;
}

export interface LogRow {
  readonly i: string;
  readonly tool: string;
  readonly desc: string;
  readonly tokens: string;
  readonly tag: 'gate' | 'agora' | 'ok';
}

export function selectLog(sel: TileVM): readonly LogRow[] {
  return RECENT_TOOLS.map((t, k) => {
    const i = sel.steps - k;
    const irreversible = t.desc.startsWith('Enviar');
    return {
      i: i > 0 ? String(i) : '—',
      tool: `android_${sel.name}_${t.tool}`,
      desc: t.desc,
      tokens: t.tool === 'get_screen_state' ? '2.6k tok' : '1.9k tok',
      tag: irreversible ? 'gate' : k === 0 && sel.state === 'running' ? 'agora' : 'ok',
    };
  });
}

export function selectSelStats(sel: TileVM): readonly Stat[] {
  return [
    { value: sel.earlyStopRemaining ? `${sel.steps}/${sel.budget} · ${sel.earlyStopRemaining} sobrando` : `${sel.steps}/${sel.budget}`, label: 'passos do orçamento' },
    { value: String(Math.max(0, Math.floor(sel.steps / 3.4))), label: 'itens no ledger' },
    { value: usd(sel.cost), label: 'custo da tarefa' },
    { value: '1,4k', label: 'tokens de tools (11)' },
  ];
}

export interface PlanTask {
  readonly name: string;
  readonly handle: string;
  readonly instr: string;
  readonly signalsOk: number;
  readonly readyLabel: string;
}

export function selectPlanTasks(tiles: readonly TileVM[]): readonly PlanTask[] {
  return tiles.map((d) => ({
    name: d.name,
    handle: d.handle,
    instr: TASK_INSTRUCTION,
    signalsOk: d.state === 'offline' ? 4 : 5,
    readyLabel: d.state === 'offline' ? 'versão mudou · fora' : 'pronto',
  }));
}

export function selectEstimate(tiles: readonly TileVM[], fleetSize: number): readonly Stat[] {
  const ready = tiles.filter((d) => d.state !== 'offline').length;
  return [
    { label: 'Tarefas', value: `${ready} de ${fleetSize} (${fleetSize - ready} fora da sonda)` },
    { label: 'Passos por conta', value: '40–60' },
    { label: 'Tokens por conta', value: '~330k (poda + subset)' },
    { label: 'Frota pronta em', value: '~3 min, starts escalonados' },
  ];
}

export interface ReportCard extends Stat { readonly tone: Tone }

export function selectReportCards(tiles: readonly TileVM[]): readonly ReportCard[] {
  const done = tiles.filter((d) => d.state === 'idle' && d.steps > 0).length + 3;
  const total = tiles.reduce((a, d) => a + d.cost, 0);
  return [
    { value: String(done), label: 'tarefas concluídas', tone: 'grey' },
    { value: '87', label: 'comentários respondidos', tone: 'green' },
    { value: String(selectNeedsCount(tiles)), label: 'precisam de você', tone: 'dark' },
    { value: usd(total), label: 'custo do objetivo', tone: 'white' },
  ];
}

export function selectNeedsList(tiles: readonly TileVM[]): readonly TileVM[] {
  return tiles.filter((d) => d.state === 'needs' || d.state === 'offline');
}

export interface CostRow { readonly name: string; readonly costFmt: string; readonly pct: number }

export function selectCostRows(tiles: readonly TileVM[]): readonly CostRow[] {
  const max = Math.max(...tiles.map((d) => d.cost), 0.01);
  return tiles.map((d) => ({ name: d.name, costFmt: usd(d.cost), pct: Math.round((d.cost / max) * 100) }));
}

export interface IdRow {
  readonly key: string;
  readonly name: string;
  readonly handle: string;
  readonly lc: Lifecycle;
  readonly app: string;
  readonly version: string;
  readonly snap: string;
  readonly disk: string;
  readonly diskPct: number;
  readonly ports: string;
  readonly dimmed: boolean;
  readonly action: string;
  readonly onAction: { readonly kind: 'open'; readonly index: number } | { readonly kind: 'extra'; readonly index: number } | null;
}

function snapshotLabel(i: number): string {
  if (i === 9) return '23 dias · restore-unsafe';
  if (i === 2) return 'há 2 dias';
  return `hoje, 09:1${i}`;
}

function actionForActive(d: Identity, i: number, diskPct: number): string {
  if (d.state === 'needs') return 'Abrir device';
  if (i === 9) return 'Confirmar restore';
  if (diskPct > 70) return 'Re-baseline';
  return '';
}

export function selectIdRows(s: FleetState, fleetSize: number): readonly IdRow[] {
  const active: IdRow[] = s.ids.map((d, i) => {
    const diskPct = DISK_PCT_BY_INDEX[i] ?? 40;
    const action = actionForActive(d, i, diskPct);
    return {
      key: d.name,
      name: d.name,
      handle: d.handle,
      lc: LIFECYCLE_BY_NAME[d.name] ?? 'logged-in',
      app: TARGET_APP,
      version: d.state === 'offline' ? '449.0 ≠ registro' : TARGET_APP_VERSION,
      snap: snapshotLabel(i),
      disk: `${ptDecimal(diskPct * 0.08)} / 8 GB`,
      diskPct,
      ports: `${5554 + i * 2} · ${8080 + i}`,
      dimmed: false,
      action,
      onAction: action && i < fleetSize ? { kind: 'open', index: i } : null,
    };
  });
  const extra: IdRow[] = s.extra.map((e, k) => ({
    key: e.name,
    name: e.name,
    handle: e.handle,
    lc: e.lc,
    app: e.app,
    version: e.version,
    snap: e.snap,
    disk: e.disk,
    diskPct: e.diskPct,
    ports: e.ports,
    dimmed: e.lc === 'banned',
    action: e.action,
    onAction: e.action ? { kind: 'extra', index: k } : null,
  }));
  return [...active, ...extra];
}

export function lifecycleTone(lc: Lifecycle): Tone {
  if (lc === 'running') return 'green';
  if (lc === 'dirty' || lc === 'banned') return 'dark';
  return 'white';
}

export interface RoleVM {
  readonly key: RoleKey;
  readonly name: string;
  readonly volume: string;
  readonly tone: Tone;
  readonly mode: ProviderMode;
  readonly model: string;
  readonly endpoint: string;
  readonly testLabel: string;
  readonly testing: boolean;
  readonly result: readonly TestResultRow[] | null;
  readonly models: readonly string[];
  readonly error: string | null;
}

export function selectRoles(s: FleetState): readonly RoleVM[] {
  return ROLES.map((r) => {
    const mode = s.modes[r.key];
    const stage = s.tests[r.key];
    const model = modelFor(r.key, mode);
    return {
      key: r.key,
      name: r.name,
      volume: r.volume,
      tone: r.tone,
      mode,
      model,
      models: s.providerModels[r.key] ?? [model],
      error: s.providerErrors[r.key] ?? null,
      endpoint: endpointFor(mode),
      testLabel: stage === 'run' ? 'Rodando tool-call canônico em conta1…' : 'Testar conexão',
      testing: stage === 'run',
      result: stage === 'done' ? testResultFor(mode) : null,
    };
  });
}
