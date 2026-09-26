import type { TestResultRow } from '../data/providers';
import type { LogRow, RoleVM } from '../state/selectors';
import type { DeviceState, Identity, VideoStreamState } from '../types/fleet';
import type { FleetSnapshot, LiveFrame, LiveIdentity, LiveProviderTest } from './types';

const STATE_MAP: Readonly<Record<string, DeviceState>> = {
  running: 'running', idle: 'idle', 'logged-in': 'idle', restored: 'idle', dirty: 'idle', provisioned: 'idle', blank: 'idle',
  'needs-human': 'needs', banned: 'needs', offline: 'offline',
};

const VIDEO_STATES: readonly string[] = ['idle', 'starting', 'streaming', 'retrying'];
const toVideoState = (v: string | undefined): VideoStreamState | undefined =>
  v !== undefined && VIDEO_STATES.includes(v) ? (v as VideoStreamState) : undefined;

const toIdentity = (base: Identity | undefined, l: LiveIdentity, f: LiveFrame | undefined): Identity => ({
  ...(base ?? {}), id: l.id, name: l.name, handle: l.handle, state: STATE_MAP[l.state] ?? 'offline',
  task: l.degraded ? `${l.task} · degradada` : l.task, steps: l.steps, budget: l.budget, cost: l.costUsd, error: l.error,
  genMs: l.genMs ?? 0, degraded: l.degraded ?? false, earlyStopRemaining: l.earlyStopRemaining ?? 0,
  video: toVideoState(l.video),
  ...(f ? { screen: { dataUrl: `data:image/png;base64,${f.png}`, at: f.at } } : {}),
});
/** Sobrepõe cada identidade viva ao tile de mesma posição; posters casam por id (spec inc. 4 §4.3). Tiles além da lista viva ficam mock. */
export function mergeLive(ids: readonly Identity[], live: FleetSnapshot | null, frames: Readonly<Record<string, LiveFrame>> = {}): readonly Identity[] {
  if (!live || live.identities.length === 0) return ids;
  const merged = live.identities.map((l, i) => toIdentity(ids[i], l, frames[l.id]));
  return [...merged, ...ids.slice(live.identities.length)];
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
