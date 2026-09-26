import { PT, type I18n } from '../i18n/translate';
import { hostMeters, liveHostMeters, type Meter } from '../lib/resources';
import { liveLogFor, mergeLive } from '../live/merge';
import type { FleetSnapshot, GoalSummary, LiveFrame } from '../live/types';
import { requestOf, type FleetState } from './fleetReducer';
import { idKey, inputKey } from './identityActions';
import { selectLiveSelStats, streamLabel } from './liveSelectors';
import { selectLog, selectNeedsCount, selectSelStats, selectTiles, type LogRow, type Stat, type TileVM } from './selectors';

// Composição do que as telas veem: modo vivo (snapshot) × demo (dados do design). Pura, testável em node.

/** Frota do demo: alvo de 8 do spec §3 (teto por CPU). */
export const DEMO_FLEET_SIZE = 8;

export interface FleetView {
  readonly isLive: boolean;
  readonly fleetSize: number;
  readonly tiles: readonly TileVM[];
  readonly killed: boolean;
  readonly needsCount: number;
  /** Só no vivo: sem snapshot ainda ('connecting') ou sem identidades ('empty'). */
  readonly empty: 'connecting' | 'empty' | null;
  readonly meters: readonly Meter[];
  readonly goal: GoalSummary | null;
}

export function buildFleetView(
  s: FleetState, live: FleetSnapshot | null, frames: Readonly<Record<string, LiveFrame>>, bridged: boolean, i18n: I18n = PT,
): FleetView {
  const isLive = bridged || live !== null;
  if (!isLive) {
    const tiles = selectTiles(s, DEMO_FLEET_SIZE, i18n);
    return {
      isLive, fleetSize: DEMO_FLEET_SIZE, tiles, killed: s.killed, needsCount: selectNeedsCount(tiles), empty: null,
      meters: hostMeters(DEMO_FLEET_SIZE, i18n), goal: null,
    };
  }
  const ids = live ? mergeLive(s.ids, live, frames, i18n) : [];
  const killed = live?.killed ?? false;
  const tiles = selectTiles({ ...s, ids, killed }, ids.length, i18n);
  return {
    isLive, fleetSize: ids.length, tiles, killed, needsCount: selectNeedsCount(tiles),
    empty: !live ? 'connecting' : ids.length === 0 ? 'empty' : null,
    meters: liveHostMeters(live?.host, i18n), goal: live?.goal ?? null,
  };
}

export interface DeviceView {
  readonly control: boolean;
  readonly paused: boolean;
  readonly streamLabel: string;
  readonly log: readonly LogRow[];
  readonly stats: readonly Stat[];
  readonly busy: boolean;
  readonly errors: readonly string[];
}

export function buildDeviceView(s: FleetState, v: FleetView, live: FleetSnapshot | null, sel: TileVM, i18n: I18n = PT): DeviceView {
  if (!v.isLive) {
    return {
      control: s.control, paused: sel.state === 'idle',
      streamLabel: i18n.t(s.control ? 'common.video.inputOn' : 'common.video.inputOff', { video: s.control ? '1080p · 60 fps' : '1080p · 30 fps' }),
      log: selectLog(sel, i18n), stats: selectSelStats(sel, i18n), busy: false, errors: [],
    };
  }
  const control = sel.live?.controlled ?? false;
  const id = sel.id ?? '';
  const req = requestOf(s, idKey(id));
  const inputErr = requestOf(s, inputKey(id)).error;
  return {
    control, paused: sel.live?.paused ?? false, streamLabel: streamLabel(sel.video, control, i18n),
    log: liveLogFor(live, sel.id, i18n), stats: selectLiveSelStats(sel, i18n), busy: req.busy,
    errors: [req.error, inputErr].filter((e): e is string => !!e),
  };
}
