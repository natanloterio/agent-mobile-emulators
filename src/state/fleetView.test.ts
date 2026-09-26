import { describe, expect, it } from 'vitest';
import { createInitialState, fleetReducer } from './fleetReducer';
import { goalSummary, hostMetrics, liveId } from './fixtures';
import { buildDeviceView, buildFleetView, DEMO_FLEET_SIZE } from './fleetView';

const snap = (over: object = {}) => ({
  killed: false, updatedAt: 'x', goal: goalSummary(), host: hostMetrics(),
  identities: [liveId({ id: 'a', name: 'a' }), liveId({ id: 'b', name: 'b', discardedAt: '2026-09-01 00:00:00' }), liveId({ id: 'c', name: 'c', state: 'needs-human', error: 'checkpoint' })],
  ...over,
});

describe('buildFleetView', () => {
  it('demo: 8 tiles do design, medidores das constantes, kill local', () => {
    const s = fleetReducer(createInitialState(), { type: 'kill' });
    const v = buildFleetView(s, null, {}, false);
    expect(v.isLive).toBe(false); expect(v.fleetSize).toBe(DEMO_FLEET_SIZE); expect(v.tiles).toHaveLength(8);
    expect(v.killed).toBe(true); expect(v.empty).toBeNull(); expect(v.meters[1].label).toBe('vCPU');
  });
  it('vivo: só identidades do snapshot, frota = não descartadas, kill e host do snapshot', () => {
    const s = fleetReducer(createInitialState(), { type: 'kill' });
    const v = buildFleetView(s, snap(), {}, true);
    expect(v.isLive).toBe(true); expect(v.fleetSize).toBe(2);
    expect(v.tiles.map((t) => t.id)).toEqual(['a', 'c']);
    expect(v.killed).toBe(false); expect(v.needsCount).toBe(1);
    expect(v.meters[0].value).toBe('40,3 / 125,6 GiB'); expect(v.goal?.id).toBe('g1');
  });
  it('vivo sem snapshot ainda: conectando; snapshot sem identidades: vazio', () => {
    expect(buildFleetView(createInitialState(), null, {}, true)).toMatchObject({ isLive: true, empty: 'connecting', tiles: [], fleetSize: 0 });
    expect(buildFleetView(createInitialState(), snap({ identities: [] }), {}, true).empty).toBe('empty');
    expect(buildFleetView(createInitialState(), null, {}, true).meters.map((m) => m.value)).toEqual(['—', '—', '—']);
  });
  it('snapshot sem bridge (improvável) também conta como vivo', () => {
    expect(buildFleetView(createInitialState(), snap(), {}, false).isLive).toBe(true);
  });
});

describe('buildDeviceView', () => {
  it('vivo: controle/pausa do snapshot, log real (vazio sem passos), stats reais, erros da identidade e do input', () => {
    const s0 = fleetReducer(createInitialState(), { type: 'toggleControl' }); // estado local ignorado no vivo
    const s = fleetReducer(fleetReducer(s0, { type: 'requestError', key: 'id:a', message: 'pause falhou' }), { type: 'requestError', key: 'input:a', message: 'sem controle' });
    const sn = snap({ identities: [liveId({ id: 'a', name: 'a', controlled: false, paused: true, video: 'starting' })] });
    const v = buildFleetView(s, sn, {}, true);
    const d = buildDeviceView(s, v, sn, v.tiles[0]);
    expect(d).toMatchObject({ control: false, paused: true, streamLabel: 'vídeo iniciando… · input desligado', log: [], busy: false });
    expect(d.stats[1]).toEqual({ value: '4', label: 'itens no ledger' });
    expect(d.errors).toEqual(['pause falhou', 'sem controle']);
  });
  it('demo: controle local e textos do design', () => {
    const s = fleetReducer(createInitialState(), { type: 'toggleControl' });
    const v = buildFleetView(s, null, {}, false);
    const d = buildDeviceView(s, v, null, v.tiles[0]);
    expect(d.control).toBe(true); expect(d.streamLabel).toBe('1080p · 60 fps · input ligado');
    expect(d.log.length).toBeGreaterThan(0); expect(d.errors).toEqual([]);
    expect(d.paused).toBe(false);
  });
});
