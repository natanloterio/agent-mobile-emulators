import { PT, type I18n } from '../i18n/translate';
import type { CredentialsStatus, LiveIdentity, LoginResult } from '../live/types';
import { credKey, loginKey } from './credentialActions';
import type { RequestStatus } from './fleetReducer';
import { idKey } from './identityActions';
import { appLabel } from './liveSelectors';
import type { Tone } from './selectors';

// Linhas da tela Identidades (spec inc. 5 §1): colunas reais do banco e ações ligadas às rotas §3.2.

export type RowActionKind = 'open' | 'extra' | 'boot-window' | 'boot' | 'login' | 'pin' | 'discard' | 'restore' | 'rebaseline'
  | 'creds' | 'autologin' | 'forget';
export interface RowAction { readonly kind: RowActionKind; readonly label: string; readonly index?: number }

export interface IdRow {
  readonly key: string;
  /** Id do daemon (modo vivo); ausente no demo. */
  readonly id?: string;
  readonly name: string;
  readonly handle: string;
  /** Estado cru do ciclo (o banco usa também idle, offline, needs-human). */
  readonly lc: string;
  readonly app: string;
  readonly version: string;
  readonly snap: string;
  readonly disk: string;
  readonly diskPct: number;
  readonly ports: string;
  readonly dimmed: boolean;
  readonly actions: readonly RowAction[];
  readonly error: string | null;
  readonly busy: boolean;
  /** Username com credencial salva (modo vivo); a senha nunca chega à tela. */
  readonly credUser?: string | null;
  /** "Fazer login" em andamento (o botão mostra "Fazendo login…"). */
  readonly loginBusy?: boolean;
  /** Resultado do último "Fazer login". */
  readonly loginNote?: LoginNote | null;
}

export interface LoginNote { readonly tone: 'ok' | 'human'; readonly text: string }

/** Credenciais do cofre do main e resultados de login; `status` null = sem cofre (nenhuma ação nova). */
export interface CredRowInput { readonly status: CredentialsStatus | null; readonly results: Readonly<Record<string, LoginResult>> }
const NO_CREDS: CredRowInput = { status: null, results: {} };
// Estados em que o daemon aceita tentar o login (spec login determinístico).
const AUTOLOGIN_STATES: readonly string[] = ['blank', 'provisioned', 'needs-human', 'offline'];

const GiB = 2 ** 30;
export const DISK_CAP_BYTES = 8 * GiB;
const DISK_HIGH = 0.7;
const DAY_MS = 86_400_000;

const TONE_BY_STATE: Readonly<Record<string, Tone>> = {
  running: 'green', dirty: 'dark', banned: 'dark', 'needs-human': 'dark', offline: 'grey',
};
export const lifecycleTone = (lc: string): Tone => TONE_BY_STATE[lc] ?? 'white';

/** SQLite grava `datetime('now')` sem fuso (UTC); ISO passa direto — mesma regra do daemon. */
function parseUtc(at: string): number {
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(at) ? at : `${at.replace(' ', 'T')}Z`);
}
const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

export function snapshotLabel(at: string | null | undefined, restoreUnsafe: boolean, now: number, i18n: I18n = PT): string {
  if (!at) return '—';
  const t = parseUtc(at);
  if (!Number.isFinite(t)) return '—';
  const days = Math.max(0, Math.round((startOfDay(now) - startOfDay(t)) / DAY_MS));
  if (restoreUnsafe) return i18n.t('identities.snap.unsafe', { count: days });
  if (days === 0) return i18n.t('identities.snap.today', { time: i18n.fmt.time(new Date(t)) });
  return i18n.t('identities.snap.ago', { count: days });
}

export function diskView(bytes: number | null | undefined, i18n: I18n = PT): { disk: string; diskPct: number; high: boolean } {
  if (bytes === null || bytes === undefined) return { disk: '—', diskPct: 0, high: false };
  const ratio = bytes / DISK_CAP_BYTES;
  return { disk: i18n.t('identities.disk.value', { used: i18n.fmt.decimal(bytes / GiB) }), diskPct: Math.min(100, Math.round(ratio * 100)), high: ratio > DISK_HIGH };
}

function liveRowActions(l: LiveIdentity, tileIndex: number, { t }: I18n, creds: CredRowInput): readonly RowAction[] {
  if (l.discardedAt) return [];
  const lc = l.lifecycle ?? l.state;
  if (lc === 'banned') return [{ kind: 'discard', label: t('identities.action.discard') }];
  const out: RowAction[] = [];
  if (lc === 'blank' || lc === 'provisioned') out.push({ kind: 'boot-window', label: t('identities.action.bootWindow') }, { kind: 'login', label: t('identities.action.loginDone') });
  if (lc === 'offline') out.push({ kind: 'boot', label: t('identities.action.boot') });
  if (lc === 'needs-human') out.push({ kind: 'open', label: t('identities.action.open'), index: tileIndex });
  if (l.restoreUnsafe) out.push({ kind: 'restore', label: t('identities.action.restore') });
  if (diskView(l.diskBytes).high) out.push({ kind: 'rebaseline', label: t('identities.action.rebaseline') });
  // Daemon destrava sozinho com o PIN; sem ele, um reboot deixa o device parado na tela de bloqueio.
  if (l.hasPin === false) out.push({ kind: 'pin', label: t('identities.action.pin') });
  if (!creds.status) return out;
  const saved = !!creds.status[l.id];
  if (saved && AUTOLOGIN_STATES.includes(lc)) out.push({ kind: 'autologin', label: t('identities.action.login') });
  out.push({ kind: 'creds', label: t('identities.action.credentials') });
  if (saved) out.push({ kind: 'forget', label: t('identities.action.forgetCredentials') });
  return out;
}

function loginNote(r: LoginResult | undefined, { t }: I18n): LoginNote | null {
  if (!r) return null;
  if (r.outcome === 'needs-human') return { tone: 'human', text: t('identities.login.needsHuman', { detail: r.detail }) };
  return { tone: 'ok', text: t(r.outcome === 'logged-in' ? 'identities.login.loggedIn' : 'identities.login.already') };
}

/** Todas as identidades do snapshot, descartadas inclusive (esmaecidas); o índice do tile ignora as descartadas. */
export function selectLiveIdRows(
  identities: readonly LiveIdentity[], requests: Readonly<Record<string, RequestStatus>>, now: number, i18n: I18n = PT,
  creds: CredRowInput = NO_CREDS,
): readonly IdRow[] {
  let tile = 0;
  return identities.map((l) => {
    const tileIndex = l.discardedAt ? -1 : tile++;
    const { disk, diskPct } = diskView(l.diskBytes, i18n);
    const req = requests[idKey(l.id)]; const cred = requests[credKey(l.id)]; const login = requests[loginKey(l.id)];
    return {
      key: l.id, id: l.id, name: l.name, handle: l.handle || i18n.t('identities.handle.none'), lc: l.lifecycle ?? l.state,
      app: appLabel(l.appPackage), version: l.appVersionName || '—',
      snap: snapshotLabel(l.snapshotTakenAt, l.restoreUnsafe ?? false, now, i18n), disk, diskPct,
      ports: l.consolePort && l.mcpHostPort ? `${l.consolePort} · ${l.mcpHostPort}` : '—',
      dimmed: !!l.discardedAt, actions: liveRowActions(l, tileIndex, i18n, creds),
      error: req?.error ?? cred?.error ?? login?.error ?? null, busy: !!(req?.busy || cred?.busy || login?.busy),
      credUser: creds.status?.[l.id]?.username ?? null, loginBusy: login?.busy ?? false,
      loginNote: loginNote(creds.results[l.id], i18n),
    };
  });
}
