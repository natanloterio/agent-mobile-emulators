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

const toIdentity = (l: LiveIdentity, f: LiveFrame | undefined): Identity => ({
  id: l.id, name: l.name, handle: l.handle, state: l.paused ? 'paused' : STATE_MAP[l.state] ?? 'offline',
  task: l.degraded ? `${l.task} · degradada` : l.task, steps: l.steps, budget: l.budget, cost: l.costUsd, error: l.error || (l.bannedReason ? `banida: ${l.bannedReason}` : ''),
  genMs: l.genMs ?? 0, degraded: l.degraded ?? false, earlyStopRemaining: l.earlyStopRemaining ?? 0,
  video: toVideoState(l.video), live: l,
  ...(f ? { screen: { dataUrl: `data:image/png;base64,${f.png}`, at: f.at } } : {}),
});
/**
 * Frota do modo vivo: só as identidades do snapshot (todas, sem teto e sem completar com demo), menos as descartadas;
 * posters casam por id (spec inc. 4 §4.3). Sem snapshot (Vite no browser) devolve o demo intacto.
 */
export function mergeLive(ids: readonly Identity[], live: FleetSnapshot | null, frames: Readonly<Record<string, LiveFrame>> = {}): readonly Identity[] {
  if (!live) return ids;
  return live.identities.filter((l) => !l.discardedAt).map((l) => toIdentity(l, frames[l.id]));
}

/** Passos recentes reais da identidade; vazio quando ainda não há passos. */
export function liveLogFor(live: FleetSnapshot | null, id: string | undefined): readonly LogRow[] {
  const l = live?.identities.find((i) => i.id === id);
  if (!l) return [];
  return l.lastTools.map((t) => ({ i: String(t.idx), tool: t.tool, desc: t.provider ? `[${t.provider.split(':')[0]}] ${t.excerpt}` : t.excerpt, tokens: `${(t.tokens / 1000).toFixed(1)}k tok`, tag: t.gate ? 'gate' : 'ok' }));
}

const fmtTps = (n: number | null) => (n === null ? '—' : n.toFixed(1).replace('.', ','));
export function testRows(t: LiveProviderTest): readonly TestResultRow[] {
  const last: TestResultRow = t.error ? { label: 'Erro', value: t.error } : t.warning ? { label: 'Aviso', value: t.warning } : { label: 'Tool', value: 'get_screen_state (tool-call canônico)' };
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
