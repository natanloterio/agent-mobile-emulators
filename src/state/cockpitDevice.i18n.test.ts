import { describe, expect, it } from 'vitest';
import { demoText } from '../data/identities';
import { createI18n, PT } from '../i18n/translate';
import { frameAgeLabel, phoneLabel } from '../live/frameAge';
import { mergeLive } from '../live/merge';
import { createInitialState, fleetReducer } from './fleetReducer';
import { ALL_OK, goalSummary, liveId } from './fixtures';
import { buildDeviceView, buildFleetView } from './fleetView';
import {
  fmtTokens, offlineOverlay, selectGoalHeader, selectLiveGoalStats, selectLiveReportCards, selectLiveSelStats, selectPastGoalRows, streamLabel,
} from './liveSelectors';
import { decorateTile, selectGoalStats, selectLog, selectSelStats, selectTiles } from './selectors';

const EN = createI18n('en');
const ZH = createI18n('zh');
const snap = (...ids: ReturnType<typeof liveId>[]) => ({ killed: false, updatedAt: 'x', identities: ids });
const liveTile = (over: Parameters<typeof liveId>[0], i18n = EN) => decorateTile(mergeLive([], snap(liveId(over)))[0], 0, false, i18n);

describe('i18n — cockpit (inglês)', () => {
  it('tiles do demo: tarefa, erro, rascunho, custo e "pausado" traduzidos; estados crus do daemon intactos', () => {
    const s = createInitialState();
    const tiles = selectTiles(s, 8, EN);
    expect(tiles[0].task).toBe('Replying to comments');
    expect(tiles[0].replyDraft).toBe('Thanks! We’ll DM you shortly');
    expect(tiles[0].stateLabel).toBe('running');
    expect(tiles[0].costFmt).toBe('$0.41');
    expect(tiles[2].error).toBe('Checkpoint: "Confirm it’s you" after the 3rd send');
    expect(tiles[2].stateLabel).toBe('needs-attention');
    expect(tiles[6].overlay).toBe('Probe: the app updated itself. Device stays out of the fleet.');
    const killed = selectTiles(fleetReducer(s, { type: 'kill' }), 8, EN);
    expect(killed[0].stateLabel).toBe('paused');
    expect(selectTiles(fleetReducer(s, { type: 'kill' }), 8)[0].stateLabel).toBe('pausado');
  });
  it('GPU no custo usa o decimal do idioma', () => {
    const t = liveTile({ genMs: 33900, costUsd: 0.2 });
    expect(t.costFmt).toBe('$0.20 · 33.9 s GPU');
    expect(liveTile({ genMs: 33900, costUsd: 0.2 }, PT).costFmt).toBe('US$ 0,20 · 33,9 s GPU');
  });
  it('vivo: tarefa e erro do daemon passam crus', () => {
    const t = liveTile({ task: 'Levantar DMs', state: 'needs-human', error: 'checkpoint do app' });
    expect(t.task).toBe('Levantar DMs'); expect(t.replyDraft).toBe('Levantar DMs'); expect(t.error).toBe('checkpoint do app');
  });
  it('stats e cabeçalho do objetivo', () => {
    const tiles = selectTiles(createInitialState(), 8, EN);
    expect(selectGoalStats(tiles, 8, true, EN).map((s) => s.label)).toEqual(['identities running', 'need you', 'cost so far']);
    expect(selectLiveGoalStats(goalSummary(), true, EN)).toEqual([
      { value: '1/4', label: 'tasks done' }, { value: '1', label: 'need you' }, { value: '$1.50', label: 'cost so far' },
    ]);
    expect(selectGoalHeader(goalSummary(), EN).kicker).toBe('Goal running · fan-out');
    expect(selectGoalHeader(goalSummary({ state: 'done', pattern: 'sharding' }), EN).kicker).toBe('Last goal · done · sharding');
    expect(selectGoalHeader(null, EN)).toEqual({ kicker: 'No goal yet', title: 'Create a goal to get the fleet started.' });
    expect(selectLiveReportCards(goalSummary(), EN).map((c) => c.label)).toEqual(['tasks done', 'items handled (ledger)', 'need you', 'goal cost']);
    expect(selectPastGoalRows([goalSummary()], EN)[0].cost).toBe('$1.50');
  });
  it('faixa de offline: sinais e erro do daemon crus dentro da frase traduzida', () => {
    expect(liveTile({ state: 'offline', signals: { ...ALL_OK, accessibility: false } }).overlay).toBe('Probe failed: accessibility. Device out of the fleet.');
    expect(liveTile({ state: 'offline', signals: null, error: 'adb: device offline' }).overlay).toBe('Offline: adb: device offline');
    expect(liveTile({ state: 'offline', signals: null }).overlay).toBe('Offline: emulator not visible to adb.');
    expect(offlineOverlay({ name: 'x', handle: '', state: 'offline', task: '', steps: 0, budget: 0, cost: 0, error: '' }, ZH)).toBe('探测：应用已自行更新，该设备不加入设备群。');
  });
});

describe('i18n — device e vídeo (inglês)', () => {
  it('rótulos de stream e idade do quadro', () => {
    expect(streamLabel('retrying', undefined, EN)).toBe('video reconnecting…');
    expect(streamLabel('starting', true, EN)).toBe('video starting… · input on');
    expect(streamLabel(undefined, false, EN)).toBe('no video · input off');
    const t0 = Date.parse('2026-09-26T12:00:00.000Z');
    expect(frameAgeLabel(t0, t0 + 900, EN)).toBe('video · live');
    expect(frameAgeLabel(t0, t0 + 7_000, EN)).toBe('7 s ago');
    expect(frameAgeLabel(t0, t0 + 150_000, EN)).toBe('2 min ago');
    expect(frameAgeLabel('lixo', t0, EN)).toBe('video');
    expect(frameAgeLabel(t0, t0 + 7_000, ZH)).toBe('7 秒前');
    expect(phoneLabel({ video: 'streaming', videoAt: t0, now: t0, fallback: 'x', i18n: EN })).toBe('video · live');
  });
  it('stats e passos do demo', () => {
    const [sel] = selectTiles(createInitialState(), 8, EN);
    expect(selectSelStats(sel, EN)).toEqual([
      { value: '34/60', label: 'steps of budget' }, { value: '10', label: 'items in ledger' },
      { value: '$0.41', label: 'task cost' }, { value: '1.4k', label: 'tool tokens (11)' },
    ]);
    expect(selectSelStats({ ...sel, earlyStopRemaining: 13 }, EN)[0].value).toBe('34/60 · 13 left');
    const log = selectLog(sel, EN);
    expect(log.map((l) => l.desc)).toContain('Send · irreversible gate ok');
    expect(log.find((l) => l.desc.startsWith('Send'))?.tag).toBe('gate');
    expect(selectLiveSelStats(liveTile({ lastStepTokens: 1432 }), EN)[3]).toEqual({ value: '1.4k', label: 'last-step tokens' });
    expect(fmtTokens(1432, createI18n('de'))).toBe('1,4k');
  });
  it('buildFleetView/buildDeviceView repassam o idioma', () => {
    const s = createInitialState();
    const v = buildFleetView(s, null, {}, false, EN);
    expect(v.tiles[0].task).toBe('Replying to comments');
    expect(v.meters[0].value).toBe('75.1 / 125 GiB');
    const d = buildDeviceView(s, v, null, v.tiles[0], EN);
    expect(d.streamLabel).toBe('1080p · 30 fps · input off');
    expect(d.stats[0].label).toBe('steps of budget');
    expect(buildDeviceView(s, buildFleetView(s, null, {}, false), null, v.tiles[0]).streamLabel).toBe('1080p · 30 fps · input desligado');
  });
  it('demoText: texto conhecido traduz, desconhecido volta como veio', () => {
    expect(demoText('Aguardando', EN)).toBe('Waiting');
    expect(demoText('Aguardando')).toBe('Aguardando');
    expect(demoText('texto do daemon', EN)).toBe('texto do daemon');
    expect(demoText('', EN)).toBe('');
  });
});
