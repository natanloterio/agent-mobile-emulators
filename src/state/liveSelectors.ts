import { PT, type I18n } from '../i18n/translate';
import type { GoalSummary, ProbeSignals } from '../live/types';
import type { Identity, VideoStreamState } from '../types/fleet';
import type { ReportCard, Stat, TileVM } from './selectors';

// Seletores do modo vivo (spec inc. 5 §1): tudo sai do snapshot ou das rotas, nada inventado.

const APP_BY_PACKAGE: Readonly<Record<string, string>> = { 'com.instagram.android': 'Instagram' };
export const appLabel = (pkg: string | undefined): string => (pkg ? APP_BY_PACKAGE[pkg] ?? pkg : '—');

const SIGNAL_LABEL: Readonly<Record<keyof ProbeSignals, string>> = {
  bootCompleted: 'boot', accessibility: 'accessibility', mcpInitialize: 'initialize', toolsPresent: 'tools', versionMatch: 'versionName',
};
/** Ordem dos 5 sinais da sonda na tela (boot · accessibility · initialize · tools · versionName). */
export const SIGNAL_ORDER: readonly (keyof ProbeSignals)[] = ['bootCompleted', 'accessibility', 'mcpInitialize', 'toolsPresent', 'versionMatch'];

/** Faixa sobre a tela de um device offline: o sinal real que falhou; no demo, o texto do design. O erro do daemon vai cru. */
export function offlineOverlay(d: Identity, i18n: I18n = PT): string {
  if (d.state !== 'offline') return '';
  const { t } = i18n;
  const l = d.live;
  if (!l) return t('cockpit.overlay.versionChanged');
  const s = l.signals;
  if (s?.versionMatch === false) return t('cockpit.overlay.versionChanged');
  const failed = s ? SIGNAL_ORDER.filter((k) => !s[k]).map((k) => SIGNAL_LABEL[k]) : [];
  if (failed.length) return t('cockpit.overlay.probeFailed', { signals: failed.join(' · ') });
  return t('cockpit.overlay.offline', { reason: l.error || t('cockpit.overlay.noAdb') });
}

const VIDEO_LABEL = {
  idle: 'common.video.idle', starting: 'common.video.starting', streaming: 'common.video.streaming', retrying: 'common.video.retrying',
} as const satisfies Readonly<Record<VideoStreamState, string>>;
/** Rótulo do stream pelo estado real do vídeo (o PhoneMock troca por "ao vivo"/idade quando há quadro). */
export function streamLabel(video: VideoStreamState | undefined, control?: boolean, i18n: I18n = PT): string {
  const base = i18n.t(VIDEO_LABEL[video ?? 'idle']);
  return control === undefined ? base : i18n.t(control ? 'common.video.inputOn' : 'common.video.inputOff', { video: base });
}

export function fmtTokens(n: number, i18n: I18n = PT): string {
  return n >= 1000 ? `${i18n.fmt.decimal(n / 1000)}k` : String(n);
}

export interface GoalHeader { readonly kicker: string; readonly title: string }

export function selectGoalHeader(g: GoalSummary | null | undefined, i18n: I18n = PT): GoalHeader {
  const { t } = i18n;
  if (!g) return { kicker: t('cockpit.goal.none.kicker'), title: t('cockpit.goal.none.title') };
  const kicker = g.state === 'running'
    ? t('cockpit.goal.running', { pattern: g.pattern })
    : t('cockpit.goal.last', { state: g.state, pattern: g.pattern });
  return { kicker, title: g.text };
}

const doneOf = (g: GoalSummary) => `${g.tasksDone}/${g.tasksTotal}`;

export function selectLiveGoalStats(g: GoalSummary | null | undefined, showCost: boolean, i18n: I18n = PT): readonly Stat[] {
  const { t, fmt } = i18n;
  return [
    { value: g ? doneOf(g) : '—', label: t('common.stat.tasksDone') },
    { value: g ? String(g.tasksNeeds) : '—', label: t('common.stat.needYou') },
    { value: g && showCost ? fmt.usd(g.costUsd) : '—', label: t('common.stat.costSoFar') },
  ];
}

export function selectLiveGoalPct(g: GoalSummary | null | undefined): number {
  return g && g.tasksTotal > 0 ? Math.round((g.tasksDone / g.tasksTotal) * 100) : 0;
}

export function selectLiveSelStats(sel: TileVM, i18n: I18n = PT): readonly Stat[] {
  const { t, fmt } = i18n;
  const l = sel.live;
  return [
    { value: `${sel.steps}/${sel.budget}`, label: t('common.stat.stepsBudget') },
    { value: String(l?.ledgerCount ?? 0), label: t('common.stat.ledgerItems') },
    { value: fmt.usd(sel.cost), label: t('common.stat.taskCost') },
    { value: fmtTokens(l?.lastStepTokens ?? 0, i18n), label: t('common.stat.lastStepTokens') },
  ];
}

export function selectLiveReportCards(g: GoalSummary | null | undefined, i18n: I18n = PT): readonly ReportCard[] {
  const { t, fmt } = i18n;
  return [
    { value: g ? doneOf(g) : '—', label: t('common.stat.tasksDone'), tone: 'grey' },
    { value: g ? String(g.itemsHandled) : '—', label: t('common.stat.itemsHandled'), tone: 'green' },
    { value: g ? String(g.tasksNeeds) : '—', label: t('common.stat.needYou'), tone: 'dark' },
    { value: g ? fmt.usd(g.costUsd) : '—', label: t('common.stat.goalCost'), tone: 'white' },
  ];
}

export interface PastGoalRow { readonly key: string; readonly text: string; readonly pattern: string; readonly result: string; readonly cost: string }

export function selectPastGoalRows(goals: readonly GoalSummary[], i18n: I18n = PT): readonly PastGoalRow[] {
  return goals.map((g) => ({ key: g.id, text: g.text, pattern: g.pattern, result: `${doneOf(g)} · ${g.tasksNeeds} needs`, cost: i18n.fmt.usd(g.costUsd) }));
}
