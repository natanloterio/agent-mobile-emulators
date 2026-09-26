import type { LogRow } from '../state/selectors';
import type { DeviceState, Identity } from '../types/fleet';
import type { FleetSnapshot } from './types';

const STATE_MAP: Readonly<Record<string, DeviceState>> = {
  running: 'running', idle: 'idle', 'logged-in': 'idle', restored: 'idle', dirty: 'idle', provisioned: 'idle', blank: 'idle',
  'needs-human': 'needs', banned: 'needs', offline: 'offline',
};

/** Sobrepõe a identidade viva (índice 0) ao mock, sem tocar nas demais. */
export function mergeLive(ids: readonly Identity[], live: FleetSnapshot | null): readonly Identity[] {
  const l = live?.identities[0];
  if (!l || ids.length === 0) return ids;
  const first: Identity = {
    ...ids[0], name: l.name, handle: l.handle, state: STATE_MAP[l.state] ?? 'offline',
    task: l.task, steps: l.steps, budget: l.budget, cost: l.costUsd, error: l.error,
  };
  return [first, ...ids.slice(1)];
}

export function liveLogFor(live: FleetSnapshot | null, name: string): readonly LogRow[] | null {
  const l = live?.identities.find((i) => i.name === name);
  if (!l || l.lastTools.length === 0) return null;
  return l.lastTools.map((t) => ({ i: String(t.idx), tool: t.tool, desc: t.excerpt, tokens: `${(t.tokens / 1000).toFixed(1)}k tok`, tag: t.gate ? 'gate' : 'ok' }));
}
