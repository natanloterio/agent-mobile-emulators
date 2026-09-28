import { demoText, DISK_PCT_BY_INDEX, LIFECYCLE_BY_NAME, RECENT_TOOLS, TARGET_APP, TARGET_APP_VERSION } from '../data/identities';
import { endpointFor, modelFor, ROLES, roleName, roleVolume, testResultFor, type TestResultRow } from '../data/providers';
import { taskInstruction } from '../data/goals';
import type { MessageKey } from '../i18n/messages';
import { PT, type I18n } from '../i18n/translate';
import { LOCALE_TAGS } from '../i18n/locales';
import type { DeviceState, Identity, ProviderMode, RoleKey } from '../types/fleet';
import type { FleetState, LocalCatalog } from './fleetReducer';
import type { LocalRuntime } from '../live/types';
import { appLabel, offlineOverlay, streamLabel } from './liveSelectors';
import type { IdRow } from './idRows';

export { lifecycleTone, type IdRow } from './idRows';

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
  /** Rótulo do stream no tile: estado real do vídeo no vivo; resolução do design no demo. */
  readonly streamLabel: string;
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

export function decorateTile(d: Identity, index: number, killed: boolean, i18n: I18n = PT): TileVM {
  const { t, fmt } = i18n;
  const effState = effectiveState(d, killed);
  const needs = d.state === 'needs';
  return {
    ...d,
    // Demo: tarefa e erro do design no idioma da tela; vivo: texto do daemon como vem.
    ...(d.live ? {} : { task: demoText(d.task, i18n), error: demoText(d.error, i18n) }),
    index,
    effState,
    // Estados crus do daemon ficam como estão; só "pausado" é português.
    stateLabel: effState === 'paused' ? t('common.state.paused') : d.live?.booting ? t('identities.booting.pill') : STATE_LABEL[effState],
    pillTone: STATE_TONE[effState],
    pillGreenBorder: needs,
    cardTone: needs ? 'dark' : d.state === 'running' ? 'grey' : 'white',
    costFmt: d.genMs ? `${fmt.usd(d.cost)} · ${fmt.decimal(d.genMs / 1000)} s GPU` : fmt.usd(d.cost),
    // Modo vivo: app/versão do banco e a tarefa real no rascunho; demo: textos do design.
    app: d.live ? appLabel(d.live.appPackage) : TARGET_APP,
    version: d.live ? d.live.appVersionName || '—' : TARGET_APP_VERSION,
    needs,
    overlay: offlineOverlay(d, i18n),
    replyDraft: d.live ? d.task : t(d.state === 'running' ? 'common.demo.draft.running' : 'common.demo.draft.off'),
    streamLabel: d.live ? streamLabel(d.video, undefined, i18n) : '320p · 4 fps',
  };
}

export function selectTiles(s: FleetState, fleetSize: number, i18n: I18n = PT): readonly TileVM[] {
  return s.ids.slice(0, fleetSize).map((d, i) => decorateTile(d, i, s.killed, i18n));
}

export function selectSelected(tiles: readonly TileVM[], sel: number): TileVM {
  return tiles[Math.min(sel, tiles.length - 1)];
}

export interface Stat { readonly value: string; readonly label: string }

/** `killed`: com o kill switch acionado ninguém está rodando, mesmo que o estado do tile ainda diga `running`. */
export function selectGoalStats(tiles: readonly TileVM[], fleetSize: number, showCost: boolean, i18n: I18n = PT, killed = false): readonly Stat[] {
  const { t, fmt } = i18n;
  const running = killed ? 0 : tiles.filter((d) => d.state === 'running').length;
  const needs = selectNeedsCount(tiles);
  const total = tiles.reduce((a, d) => a + d.cost, 0);
  return [
    { value: `${running}/${fleetSize}`, label: t('common.stat.running') },
    { value: String(needs), label: t('common.stat.needYou') },
    { value: showCost ? fmt.usd(total) : '—', label: t('common.stat.costSoFar') },
  ];
}

export function selectGoalPct(tiles: readonly TileVM[]): number {
  const done = tiles.reduce((a, d) => a + d.steps, 0);
  return Math.round((done / (tiles.length * TASKS_PER_IDENTITY)) * 100);
}

const ATTENTION: Readonly<Record<string, number>> = { needs: 0, offline: 1 };
/**
 * Ordem de exibição do Cockpit: quem precisa de alguém primeiro, para não ficar abaixo da dobra numa frota de 8.
 * Só a ordem muda; cada tile guarda o próprio `index` (abrir o device segue certo).
 */
export function byAttention<T extends { readonly state: string }>(tiles: readonly T[]): readonly T[] {
  const rank = (t: T) => ATTENTION[t.state] ?? 2;
  return tiles.map((t, i) => ({ t, i })).sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i).map((x) => x.t);
}

/** Mesmo recorte da lista "Precisam de você" do Relatório: contador e lista nunca discordam. */
export function selectNeedsCount(tiles: readonly TileVM[]): number {
  return selectNeedsList(tiles).length;
}

export interface LogRow {
  readonly i: string;
  readonly tool: string;
  readonly desc: string;
  readonly tokens: string;
  readonly tag: 'gate' | 'agora' | 'ok';
}

export function selectLog(sel: TileVM, i18n: I18n = PT): readonly LogRow[] {
  return RECENT_TOOLS.map((t, k) => {
    const i = sel.steps - k;
    const irreversible = t.desc.startsWith('Enviar');
    return {
      i: i > 0 ? String(i) : '—',
      tool: `android_${sel.name}_${t.tool}`,
      desc: demoText(t.desc, i18n),
      tokens: t.tool === 'get_screen_state' ? '2.6k tok' : '1.9k tok',
      tag: irreversible ? 'gate' : k === 0 && sel.state === 'running' ? 'agora' : 'ok',
    };
  });
}

export function selectSelStats(sel: TileVM, i18n: I18n = PT): readonly Stat[] {
  const { t, fmt } = i18n;
  const steps = sel.budget === null ? `${sel.steps}` : sel.earlyStopRemaining
    ? t('common.stat.stepsLeft', { steps: sel.steps, budget: sel.budget, n: sel.earlyStopRemaining })
    : `${sel.steps}/${sel.budget}`;
  return [
    { value: steps, label: t('common.stat.stepsBudget') },
    { value: String(Math.max(0, Math.floor(sel.steps / 3.4))), label: t('common.stat.ledgerItems') },
    { value: fmt.usd(sel.cost), label: t('common.stat.taskCost') },
    { value: `${fmt.decimal(1.4)}k`, label: t('common.stat.toolTokens', { n: 11 }) },
  ];
}

export interface PlanTask {
  readonly name: string;
  readonly handle: string;
  readonly instr: string;
  readonly signalsOk: number;
  readonly readyLabel: string;
}

export function selectPlanTasks(tiles: readonly TileVM[], i18n: I18n = PT): readonly PlanTask[] {
  return tiles.map((d) => ({
    name: d.name,
    handle: d.handle,
    instr: taskInstruction(i18n),
    signalsOk: d.state === 'offline' ? 4 : 5,
    readyLabel: i18n.t(d.state === 'offline' ? 'goal.ready.versionChanged' : 'goal.ready.ready'),
  }));
}

export function selectEstimate(tiles: readonly TileVM[], fleetSize: number, i18n: I18n = PT): readonly Stat[] {
  const { t } = i18n;
  const ready = tiles.filter((d) => d.state !== 'offline').length;
  return [
    { label: t('goal.est.tasks'), value: t('goal.est.tasksValue', { ready, total: fleetSize, out: fleetSize - ready }) },
    { label: t('goal.est.stepsPerAccount'), value: '40–60' },
    { label: t('goal.est.tokensPerAccount'), value: t('goal.est.tokensValue') },
    { label: t('goal.est.fleetReady'), value: t('goal.est.fleetReadyDemo') },
  ];
}

export interface ReportCard extends Stat {
  readonly tone: Tone;
  /** Como refazer o card em outro idioma dentro da tela (chave do rótulo e, no custo, o valor em dólar). */
  readonly localize?: { readonly labelKey: MessageKey; readonly usd?: number };
}

export function selectReportCards(tiles: readonly TileVM[], i18n: I18n = PT): readonly ReportCard[] {
  const { t, fmt } = i18n;
  const done = tiles.filter((d) => d.state === 'idle' && d.steps > 0).length + 3;
  const total = tiles.reduce((a, d) => a + d.cost, 0);
  const card = (value: string, labelKey: MessageKey, tone: Tone, usdValue?: number): ReportCard =>
    ({ value, label: t(labelKey), tone, localize: usdValue === undefined ? { labelKey } : { labelKey, usd: usdValue } });
  return [
    card(String(done), 'report.cards.done', 'grey'),
    card('87', 'report.cards.replies', 'green'),
    card(String(selectNeedsCount(tiles)), 'report.cards.needs', 'dark'),
    card(fmt.usd(total), 'report.cards.cost', 'white', total),
  ];
}

export function selectNeedsList(tiles: readonly TileVM[]): readonly TileVM[] {
  return tiles.filter((d) => d.state === 'needs' || d.state === 'offline');
}

/** `cost` em dólar cru: a tela reformata no idioma dela. */
export interface CostRow { readonly name: string; readonly cost: number; readonly costFmt: string; readonly pct: number }

export function selectCostRows(tiles: readonly TileVM[], i18n: I18n = PT): readonly CostRow[] {
  const max = Math.max(...tiles.map((d) => d.cost), 0.01);
  return tiles.map((d) => ({ name: d.name, cost: d.cost, costFmt: i18n.fmt.usd(d.cost), pct: Math.round((d.cost / max) * 100) }));
}

function snapshotLabel(i: number, { t, fmt }: I18n): string {
  if (i === 9) return t('identities.snap.unsafe', { count: 23 });
  if (i === 2) return t('identities.snap.ago', { count: 2 });
  return t('identities.snap.today', { time: fmt.time(new Date(2026, 0, 1, 9, 10 + i)) });
}

function actionForActive(d: Identity, i: number, diskPct: number, { t }: I18n): string {
  if (d.state === 'needs') return t('identities.action.open');
  if (i === 9) return t('identities.action.restore');
  if (d.error?.includes('≠')) return t('identities.action.acceptVersion');
  if (diskPct > 70) return t('identities.action.rebaseline');
  return '';
}

/** Dia/mês no formato do idioma (demo: "banida em 12/09"). */
const dayMonth = (day: number, month: number, i18n: I18n) =>
  new Intl.DateTimeFormat(LOCALE_TAGS[i18n.locale], { day: '2-digit', month: '2-digit' }).format(new Date(2000, month - 1, day));

/**
 * Textos das identidades extras do demo (vêm em português de data/identities e do reducer): traduz os conhecidos,
 * o resto passa como veio.
 */
function extraDemoText(pt: string, i18n: I18n): string {
  const { t, fmt } = i18n;
  const banned = /^banida em (\d\d)\/(\d\d)$/.exec(pt);
  if (banned) return t('identities.snap.bannedOn', { date: dayMonth(Number(banned[1]), Number(banned[2]), i18n) });
  const disk = /^(\d+),(\d) \/ 8 GB( presos)?$/.exec(pt);
  if (disk) return t(disk[3] ? 'identities.disk.stuck' : 'identities.disk.value', { used: fmt.decimal(Number(`${disk[1]}.${disk[2]}`)) });
  const known: Readonly<Record<string, string>> = {
    'Liberar disco': t('identities.action.discard'), 'Fazer login': t('identities.action.login'), 'agora': t('identities.snap.now'),
    'sem conta': t('identities.handle.none'), '0 GB · AVD descartado': t('identities.disk.discarded'),
  };
  return known[pt] ?? pt;
}

export function selectIdRows(s: FleetState, fleetSize: number, i18n: I18n = PT): readonly IdRow[] {
  const active: IdRow[] = s.ids.map((d, i) => {
    const diskPct = DISK_PCT_BY_INDEX[i] ?? 40;
    const action = actionForActive(d, i, diskPct, i18n);
    return {
      ...DEMO_ROW,
      key: d.name,
      name: d.name,
      handle: d.handle,
      lc: LIFECYCLE_BY_NAME[d.name] ?? 'logged-in',
      app: TARGET_APP,
      version: d.state === 'offline' ? i18n.t('identities.version.mismatch', { version: '449.0' }) : TARGET_APP_VERSION,
      snap: snapshotLabel(i, i18n),
      disk: i18n.t('identities.disk.value', { used: i18n.fmt.decimal(diskPct * 0.08) }),
      diskPct,
      ports: `${5554 + i * 2} · ${8080 + i}`,
      dimmed: false,
      actions: action && i < fleetSize ? [{ kind: 'open', label: action, index: i }] : [],
    };
  });
  const extra: IdRow[] = s.extra.map((e, k) => ({
    ...DEMO_ROW,
    key: e.name,
    name: e.name,
    handle: extraDemoText(e.handle, i18n),
    lc: e.lc,
    app: e.app,
    version: e.version,
    snap: extraDemoText(e.snap, i18n),
    disk: extraDemoText(e.disk, i18n),
    diskPct: e.diskPct,
    ports: e.ports,
    dimmed: e.lc === 'banned',
    actions: e.action ? [{ kind: 'extra', label: extraDemoText(e.action, i18n), index: k }] : [],
  }));
  return [...active, ...extra];
}

const DEMO_ROW = { error: null, busy: false } as const;

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
  /** O que o card mostra: erro do PUT se houver, senão o erro de carga da lista. */
  readonly error: string | null;
  /** Só o erro do último PUT; decide se o blur do endpoint reenvia. */
  readonly putError: string | null;
  /** Runtime local do papel vindo do snapshot; null na nuvem, no demo e com daemon antigo. */
  readonly runtime: LocalRuntime | null;
  /** Modelos baixados e estado dos runtimes; null quando o daemon não os manda (a tela segue só com `models`). */
  readonly catalog: LocalCatalog | null;
}

export function selectRoles(s: FleetState, i18n: I18n = PT): readonly RoleVM[] {
  return ROLES.map((r) => {
    const mode = s.modes[r.key];
    const stage = s.tests[r.key];
    const model = modelFor(r.key, mode);
    return {
      key: r.key,
      name: roleName(r.key, i18n),
      volume: roleVolume(r.key, i18n),
      tone: r.tone,
      mode,
      model,
      // Sem lista carregada não há opções: o seletor mostra só o modelo atual (nunca um rótulo do mock no modo vivo).
      models: s.providerModels[r.key] ?? [],
      error: s.providerErrors[r.key] ?? s.providerModelsErrors[r.key] ?? null,
      putError: s.providerErrors[r.key] ?? null,
      runtime: null,
      catalog: s.providerCatalogs[r.key] ?? null,
      endpoint: endpointFor(mode),
      testLabel: stage === 'run' ? i18n.t('providers.test.running', { account: 'conta1' }) : i18n.t('providers.test.idle'),
      testing: stage === 'run',
      result: stage === 'done' ? testResultFor(mode, i18n) : null,
    };
  });
}
