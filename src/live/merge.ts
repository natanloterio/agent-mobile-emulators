import type { TestResultRow } from '../data/providers';
import { PT, type I18n } from '../i18n/translate';
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

const toIdentity = (l: LiveIdentity, f: LiveFrame | undefined, { t }: I18n): Identity => ({
  id: l.id, name: l.name, handle: l.handle, state: l.paused ? 'paused' : STATE_MAP[l.state] ?? 'offline',
  task: l.degraded ? t('identities.live.degraded', { task: l.task }) : l.task, steps: l.steps, budget: l.budget, cost: l.costUsd,
  error: l.error || (l.bannedReason ? t('identities.live.banned', { reason: l.bannedReason }) : ''),
  genMs: l.genMs ?? 0, degraded: l.degraded ?? false, earlyStopRemaining: l.earlyStopRemaining ?? 0,
  video: toVideoState(l.video), live: l,
  ...(f ? { screen: { dataUrl: `data:image/png;base64,${f.png}`, at: f.at } } : {}),
});
/**
 * Frota do modo vivo: só as identidades do snapshot (todas, sem teto e sem completar com demo), menos as descartadas;
 * posters casam por id (spec inc. 4 §4.3). Sem snapshot (Vite no browser) devolve o demo intacto.
 */
export function mergeLive(
  ids: readonly Identity[], live: FleetSnapshot | null, frames: Readonly<Record<string, LiveFrame>> = {}, i18n: I18n = PT,
): readonly Identity[] {
  if (!live) return ids;
  return live.identities.filter((l) => !l.discardedAt).map((l) => toIdentity(l, frames[l.id], i18n));
}

/** Passos recentes reais da identidade; vazio quando ainda não há passos. */
export function liveLogFor(live: FleetSnapshot | null, id: string | undefined, { t, fmt }: I18n = PT): readonly LogRow[] {
  const l = live?.identities.find((i) => i.id === id);
  if (!l) return [];
  return l.lastTools.map((s) => ({
    i: String(s.idx), tool: s.tool, desc: s.provider ? `[${s.provider.split(':')[0]}] ${s.excerpt}` : s.excerpt,
    tokens: t('identities.log.tokens', { k: fmt.decimal(s.tokens / 1000) }), tag: s.gate ? 'gate' : 'ok',
  }));
}

/** Linhas do último teste de conexão; erro/aviso vêm do daemon e aparecem como vieram. */
export function testRows(r: LiveProviderTest, { t, fmt }: I18n = PT): readonly TestResultRow[] {
  const last: TestResultRow = r.error ? { label: t('providers.result.error'), value: r.error }
    : r.warning ? { label: t('providers.result.warning'), value: r.warning }
    : { label: t('providers.result.tool'), value: t('providers.result.canonical', { tool: 'get_screen_state' }) };
  return [
    { label: t('providers.result.latency'), value: `${r.latencyMs} ms` },
    { label: t('providers.result.tps'), value: r.tokensPerSec === null ? '—' : fmt.decimal(r.tokensPerSec) },
    { label: t('providers.result.args'), value: t(r.argsValid ? 'providers.result.argsOk' : 'providers.result.argsBad') },
    last,
  ];
}

/** Sobrepõe o registro real de provedores à tela; sem snapshot (Vite no browser) tudo segue mock. */
export function liveRoles(roles: readonly RoleVM[], live: FleetSnapshot | null, i18n: I18n = PT): readonly RoleVM[] {
  const p = live?.providers; if (!p) return roles;
  return roles.map((r) => {
    const l = p[r.key]; if (!l) return r;
    return { ...r, mode: l.mode, model: l.model, endpoint: l.endpoint, result: r.testing ? r.result : l.lastTest ? testRows(l.lastTest, i18n) : null };
  });
}
