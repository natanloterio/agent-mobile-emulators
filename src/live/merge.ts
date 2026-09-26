import type { TestResultRow } from '../data/providers';
import type { LogRow, RoleVM } from '../state/selectors';
import type { DeviceState, Identity } from '../types/fleet';
import type { FleetSnapshot, LiveProviderTest } from './types';

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
    task: l.degraded ? `${l.task} · degradada` : l.task, steps: l.steps, budget: l.budget, cost: l.costUsd, error: l.error,
    genMs: l.genMs ?? 0, degraded: l.degraded ?? false, earlyStopRemaining: l.earlyStopRemaining ?? 0,
  };
  return [first, ...ids.slice(1)];
}

export function liveLogFor(live: FleetSnapshot | null, name: string): readonly LogRow[] | null {
  const l = live?.identities.find((i) => i.name === name);
  if (!l || l.lastTools.length === 0) return null;
  return l.lastTools.map((t) => ({ i: String(t.idx), tool: t.tool, desc: t.provider ? `[${t.provider.split(':')[0]}] ${t.excerpt}` : t.excerpt, tokens: `${(t.tokens / 1000).toFixed(1)}k tok`, tag: t.gate ? 'gate' : 'ok' }));
}

const fmtTps = (n: number | null) => (n === null ? '—' : n.toFixed(1).replace('.', ','));
export function testRows(t: LiveProviderTest): readonly TestResultRow[] {
  const last: TestResultRow = t.error ? { label: 'Erro', value: t.error } : t.warning ? { label: 'Aviso', value: t.warning } : { label: 'Tool', value: 'android_conta1_get_screen_state' };
  return [{ label: 'Latência', value: `${t.latencyMs} ms` }, { label: 'Tokens/s', value: fmtTps(t.tokensPerSec) }, { label: 'Argumentos', value: t.argsValid ? 'estruturados e válidos' : 'inválidos' }, last];
}

/** Sobrepõe o registro real de provedores à tela; sem snapshot (Vite no browser) tudo segue mock. */
export function liveRoles(roles: readonly RoleVM[], live: FleetSnapshot | null): readonly RoleVM[] {
  const p = live?.providers; if (!p) return roles;
  return roles.map((r) => {
    const l = p[r.key]; if (!l) return r;
    return { ...r, mode: l.mode, model: l.model, endpoint: l.endpoint, result: r.testing ? r.result : l.lastTest ? testRows(l.lastTest) : null };
  });
}
