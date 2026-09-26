import { ptDecimal, usd } from '../lib/format';
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

const DEMO_OFFLINE = 'Sonda: app atualizou sozinho. Device não entra na frota.';

/** Faixa sobre a tela de um device offline: o sinal real que falhou; no demo, o texto do design. */
export function offlineOverlay(d: Identity): string {
  if (d.state !== 'offline') return '';
  const l = d.live;
  if (!l) return DEMO_OFFLINE;
  const s = l.signals;
  if (s?.versionMatch === false) return DEMO_OFFLINE;
  const failed = s ? SIGNAL_ORDER.filter((k) => !s[k]).map((k) => SIGNAL_LABEL[k]) : [];
  if (failed.length) return `Sonda falhou: ${failed.join(' · ')}. Device fora da frota.`;
  return `Offline: ${l.error || 'emulador fora do adb.'}`;
}

const VIDEO_LABEL: Readonly<Record<VideoStreamState, string>> = {
  idle: 'sem vídeo', starting: 'vídeo iniciando…', streaming: 'vídeo · aguardando quadro', retrying: 'vídeo reconectando…',
};
/** Rótulo do stream pelo estado real do vídeo (o PhoneMock troca por "ao vivo"/idade quando há quadro). */
export function streamLabel(video: VideoStreamState | undefined, control?: boolean): string {
  const base = VIDEO_LABEL[video ?? 'idle'];
  return control === undefined ? base : `${base} · input ${control ? 'ligado' : 'desligado'}`;
}

export function fmtTokens(n: number): string {
  return n >= 1000 ? `${ptDecimal(n / 1000)}k` : String(n);
}

export interface GoalHeader { readonly kicker: string; readonly title: string }

export function selectGoalHeader(g: GoalSummary | null | undefined): GoalHeader {
  if (!g) return { kicker: 'Nenhum objetivo ainda', title: 'Crie um objetivo para a frota começar.' };
  const kicker = g.state === 'running' ? `Objetivo em execução · ${g.pattern}` : `Último objetivo · ${g.state} · ${g.pattern}`;
  return { kicker, title: g.text };
}

const doneOf = (g: GoalSummary) => `${g.tasksDone}/${g.tasksTotal}`;

export function selectLiveGoalStats(g: GoalSummary | null | undefined, showCost: boolean): readonly Stat[] {
  return [
    { value: g ? doneOf(g) : '—', label: 'tarefas concluídas' },
    { value: g ? String(g.tasksNeeds) : '—', label: 'precisam de você' },
    { value: g && showCost ? usd(g.costUsd) : '—', label: 'custo até agora' },
  ];
}

export function selectLiveGoalPct(g: GoalSummary | null | undefined): number {
  return g && g.tasksTotal > 0 ? Math.round((g.tasksDone / g.tasksTotal) * 100) : 0;
}

export function selectLiveSelStats(sel: TileVM): readonly Stat[] {
  const l = sel.live;
  return [
    { value: `${sel.steps}/${sel.budget}`, label: 'passos do orçamento' },
    { value: String(l?.ledgerCount ?? 0), label: 'itens no ledger' },
    { value: usd(sel.cost), label: 'custo da tarefa' },
    { value: fmtTokens(l?.lastStepTokens ?? 0), label: 'tokens do último passo' },
  ];
}

export function selectLiveReportCards(g: GoalSummary | null | undefined): readonly ReportCard[] {
  return [
    { value: g ? doneOf(g) : '—', label: 'tarefas concluídas', tone: 'grey' },
    { value: g ? String(g.itemsHandled) : '—', label: 'itens tratados (ledger)', tone: 'green' },
    { value: g ? String(g.tasksNeeds) : '—', label: 'precisam de você', tone: 'dark' },
    { value: g ? usd(g.costUsd) : '—', label: 'custo do objetivo', tone: 'white' },
  ];
}

export interface PastGoalRow { readonly key: string; readonly text: string; readonly pattern: string; readonly result: string; readonly cost: string }

export function selectPastGoalRows(goals: readonly GoalSummary[]): readonly PastGoalRow[] {
  return goals.map((g) => ({ key: g.id, text: g.text, pattern: g.pattern, result: `${doneOf(g)} · ${g.tasksNeeds} needs`, cost: usd(g.costUsd) }));
}
