import { describe, expect, it } from 'vitest';
import { mergeLive } from '../live/merge';
import { ALL_OK, goalSummary, liveId } from './fixtures';
import {
  appLabel, fmtTokens, offlineOverlay, selectGoalHeader, selectLiveGoalPct, selectLiveGoalStats, selectLiveReportCards,
  selectLiveSelStats, selectPastGoalRows, streamLabel,
} from './liveSelectors';
import { decorateTile } from './selectors';

const snap = (...ids: ReturnType<typeof liveId>[]) => ({ killed: false, updatedAt: 'x', identities: ids });
const tileOf = (over: Parameters<typeof liveId>[0]) => decorateTile(mergeLive([], snap(liveId(over)))[0], 0, false);

describe('liveSelectors — cockpit', () => {
  it('cabeçalho do objetivo vem do snapshot.goal; sem objetivo, convite', () => {
    expect(selectGoalHeader(goalSummary())).toEqual({ kicker: 'Objetivo em execução · fan-out', title: 'Responder comentários' });
    expect(selectGoalHeader(goalSummary({ state: 'done', pattern: 'sharding' })).kicker).toBe('Último objetivo · done · sharding');
    expect(selectGoalHeader(null)).toEqual({ kicker: 'Nenhum objetivo ainda', title: 'Crie um objetivo para a frota começar.' });
  });
  it('stats: tarefas done/total, needs, custo; barra = done/total', () => {
    const g = goalSummary();
    expect(selectLiveGoalStats(g, true)).toEqual([
      { value: '1/4', label: 'tarefas concluídas' },
      { value: '1', label: 'precisam de você' },
      { value: 'US$ 1,50', label: 'custo até agora' },
    ]);
    expect(selectLiveGoalStats(g, false)[2].value).toBe('—');
    expect(selectLiveGoalStats(null, true).map((s) => s.value)).toEqual(['—', '—', '—']);
    expect(selectLiveGoalPct(g)).toBe(25);
    expect(selectLiveGoalPct(goalSummary({ tasksTotal: 0, tasksDone: 0 }))).toBe(0);
    expect(selectLiveGoalPct(null)).toBe(0);
  });
  it('overlay "app atualizou" só quando versionMatch === false; outros offline mostram os sinais reais', () => {
    expect(tileOf({ state: 'offline', signals: { ...ALL_OK, versionMatch: false } }).overlay).toMatch(/app atualizou sozinho/);
    expect(tileOf({ state: 'offline', signals: { ...ALL_OK, accessibility: false, toolsPresent: false } }).overlay)
      .toBe('Sonda falhou: accessibility · tools. Device fora da frota.');
    expect(tileOf({ state: 'offline', signals: null, error: 'adb: device offline' }).overlay).toBe('Offline: adb: device offline');
    expect(tileOf({ state: 'offline', signals: null }).overlay).toBe('Offline: emulador fora do adb.');
    expect(tileOf({ state: 'running' }).overlay).toBe('');
    expect(offlineOverlay({ name: 'x', handle: '', state: 'offline', task: '', steps: 0, budget: 0, cost: 0, error: '' })).toMatch(/app atualizou/);
  });
  it('tile vivo: app e versão reais, rascunho = tarefa real, rótulo de stream pelo estado do vídeo', () => {
    const t = tileOf({ task: 'Levantar DMs', video: 'retrying' });
    expect(t.app).toBe('Instagram'); expect(t.version).toBe('448.0.0.52.84');
    expect(t.replyDraft).toBe('Levantar DMs');
    expect(t.streamLabel).toBe('vídeo reconectando…');
    expect(appLabel('com.example.app')).toBe('com.example.app'); expect(appLabel(undefined)).toBe('—');
    expect(streamLabel('retrying')).toBe('vídeo reconectando…');
    expect(streamLabel('idle')).toBe('sem vídeo');
    expect(streamLabel('starting', true)).toBe('vídeo iniciando… · input ligado');
    expect(streamLabel(undefined, false)).toBe('sem vídeo · input desligado');
  });
});

describe('liveSelectors — device', () => {
  it('stats reais: passos, ledger, custo, tokens do último passo', () => {
    const t = tileOf({ steps: 9, budget: 30, ledgerCount: 12, costUsd: 0.2, lastStepTokens: 1432 });
    expect(selectLiveSelStats(t)).toEqual([
      { value: '9/30', label: 'passos do orçamento' },
      { value: '12', label: 'itens no ledger' },
      { value: 'US$ 0,20', label: 'custo da tarefa' },
      { value: '1,4k', label: 'tokens do último passo' },
    ]);
    expect(fmtTokens(830)).toBe('830'); expect(fmtTokens(0)).toBe('0'); expect(fmtTokens(12_345)).toBe('12,3k');
  });
  it('orçamento desligado (budget null): só o contador de passos, sem "/teto"', () => {
    const t = tileOf({ steps: 9, budget: null, ledgerCount: 12, costUsd: 0.2, lastStepTokens: 1432 });
    expect(selectLiveSelStats(t)[0]).toEqual({ value: '9', label: 'passos do orçamento' });
  });
});

describe('liveSelectors — relatório', () => {
  it('cards do objetivo com itens tratados do ledger', () => {
    expect(selectLiveReportCards(goalSummary())).toEqual([
      { value: '1/4', label: 'tarefas concluídas', tone: 'grey' },
      { value: '17', label: 'itens tratados (ledger)', tone: 'green' },
      { value: '1', label: 'precisam de você', tone: 'dark' },
      { value: 'US$ 1,50', label: 'custo do objetivo', tone: 'white' },
    ]);
    expect(selectLiveReportCards(null).map((c) => c.value)).toEqual(['—', '—', '—', '—']);
  });
  it('"precisam de você" conta a mesma lista que a tela mostra (identidades), mesmo sem objetivo', () => {
    expect(selectLiveReportCards(goalSummary(), undefined, 2)[2].value).toBe('2');
    expect(selectLiveReportCards(null, undefined, 1)[2].value).toBe('1');
  });
  it('objetivos anteriores: resultado done/total · N needs e custo', () => {
    expect(selectPastGoalRows([goalSummary({ id: 'a', tasksDone: 3, tasksTotal: 4, tasksNeeds: 1, costUsd: 2.5 })])).toEqual([
      { key: 'a', text: 'Responder comentários', pattern: 'fan-out', result: '3/4 · 1 needs', cost: 'US$ 2,50' },
    ]);
  });
});
