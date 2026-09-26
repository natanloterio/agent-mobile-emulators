import { ptDecimal } from '../lib/format';
import type { LiveIdentity } from '../live/types';
import type { RequestStatus } from './fleetReducer';
import { idKey } from './identityActions';
import { appLabel } from './liveSelectors';
import type { Tone } from './selectors';

// Linhas da tela Identidades (spec inc. 5 §1): colunas reais do banco e ações ligadas às rotas §3.2.

export type RowActionKind = 'open' | 'extra' | 'boot-window' | 'boot' | 'login' | 'discard' | 'restore' | 'rebaseline';
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
}

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
const hhmm = (t: number) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export function snapshotLabel(at: string | null | undefined, restoreUnsafe: boolean, now: number): string {
  if (!at) return '—';
  const t = parseUtc(at);
  if (!Number.isFinite(t)) return '—';
  const days = Math.max(0, Math.round((startOfDay(now) - startOfDay(t)) / DAY_MS));
  if (restoreUnsafe) return `${days} dias · restore-unsafe`;
  if (days === 0) return `hoje, ${hhmm(t)}`;
  return days === 1 ? 'há 1 dia' : `há ${days} dias`;
}

export function diskView(bytes: number | null | undefined): { disk: string; diskPct: number; high: boolean } {
  if (bytes === null || bytes === undefined) return { disk: '—', diskPct: 0, high: false };
  const ratio = bytes / DISK_CAP_BYTES;
  return { disk: `${ptDecimal(bytes / GiB)} / 8 GB`, diskPct: Math.min(100, Math.round(ratio * 100)), high: ratio > DISK_HIGH };
}

function liveRowActions(l: LiveIdentity, tileIndex: number): readonly RowAction[] {
  if (l.discardedAt) return [];
  const lc = l.lifecycle ?? l.state;
  if (lc === 'banned') return [{ kind: 'discard', label: 'Liberar disco' }];
  const out: RowAction[] = [];
  if (lc === 'blank' || lc === 'provisioned') out.push({ kind: 'boot-window', label: 'Subir com janela' }, { kind: 'login', label: 'Login feito' });
  if (lc === 'offline') out.push({ kind: 'boot', label: 'Subir' });
  if (lc === 'needs-human') out.push({ kind: 'open', label: 'Abrir device', index: tileIndex });
  if (l.restoreUnsafe) out.push({ kind: 'restore', label: 'Confirmar restore' });
  if (diskView(l.diskBytes).high) out.push({ kind: 'rebaseline', label: 'Re-baseline' });
  return out;
}

/** Todas as identidades do snapshot, descartadas inclusive (esmaecidas); o índice do tile ignora as descartadas. */
export function selectLiveIdRows(
  identities: readonly LiveIdentity[], requests: Readonly<Record<string, RequestStatus>>, now: number,
): readonly IdRow[] {
  let tile = 0;
  return identities.map((l) => {
    const tileIndex = l.discardedAt ? -1 : tile++;
    const { disk, diskPct } = diskView(l.diskBytes);
    const req = requests[idKey(l.id)];
    return {
      key: l.id, id: l.id, name: l.name, handle: l.handle || 'sem conta', lc: l.lifecycle ?? l.state,
      app: appLabel(l.appPackage), version: l.appVersionName || '—',
      snap: snapshotLabel(l.snapshotTakenAt, l.restoreUnsafe ?? false, now), disk, diskPct,
      ports: l.consolePort && l.mcpHostPort ? `${l.consolePort} · ${l.mcpHostPort}` : '—',
      dimmed: !!l.discardedAt, actions: liveRowActions(l, tileIndex),
      error: req?.error ?? null, busy: req?.busy ?? false,
    };
  });
}
