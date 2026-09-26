import type { DatabaseSync } from 'node:sqlite';

export type IdentityState =
  | 'blank' | 'provisioned' | 'logged-in' | 'running' | 'dirty' | 'restored' | 'banned'
  | 'offline' | 'needs-human' | 'idle';

export interface IdentityRow {
  readonly id: string; readonly name: string; readonly handle: string; readonly avdName: string; readonly serial: string;
  readonly consolePort: number; readonly mcpHostPort: number; readonly mcpToken: string; readonly deviceSlug: string;
  readonly appPackage: string; readonly appVersionName: string; readonly state: IdentityState;
  readonly lastError?: string | null; readonly bannedReason?: string | null; readonly snapshotTakenAt?: string | null;
  // Incremento 5 (lidos do banco; o upsert não os escreve — use setIdentityFlags).
  readonly paused?: boolean; readonly controlled?: boolean; readonly discardedAt?: string | null;
  readonly lastSignals?: ProbeSignalsRow | null; readonly diskBytes?: number | null; readonly bannedAt?: string | null;
  readonly createdAt?: string | null; readonly accountClearedAt?: string | null;
  readonly lockPin?: string | null;
}

/** Espelho de `ProbeSignals` (device/probe.ts) sem importar o módulo de device no banco. */
export interface ProbeSignalsRow {
  readonly bootCompleted: boolean; readonly accessibility: boolean; readonly mcpInitialize: boolean;
  readonly toolsPresent: boolean; readonly versionMatch: boolean;
}

export interface IdentityFlags {
  readonly paused?: boolean; readonly controlled?: boolean; readonly discardedAt?: string | null;
  readonly lastSignals?: ProbeSignalsRow | null; readonly diskBytes?: number | null;
  readonly handle?: string; readonly bannedAt?: string | null; readonly appVersionName?: string;
  readonly accountClearedAt?: string | null; readonly lockPin?: string | null;
}

const COLS = ['id','name','handle','avd_name','serial','console_port','mcp_host_port','mcp_token','device_slug','app_package','app_version_name','state'] as const;

export function upsertIdentity(db: DatabaseSync, r: IdentityRow): void {
  const sets = COLS.filter((c) => c !== 'id').map((c) => `${c}=excluded.${c}`).join(', ');
  db.prepare(`insert into identity (${COLS.join(',')}) values (${COLS.map(() => '?').join(',')})
    on conflict(id) do update set ${sets}, updated_at=datetime('now')`)
    .run(r.id, r.name, r.handle, r.avdName, r.serial, r.consolePort, r.mcpHostPort, r.mcpToken, r.deviceSlug, r.appPackage, r.appVersionName, r.state);
  db.prepare("update identity set created_at = coalesce(created_at, datetime('now')) where id=?").run(r.id);
}

function parseSignals(raw: unknown): ProbeSignalsRow | null {
  if (typeof raw !== 'string' || !raw) return null;
  try { return JSON.parse(raw) as ProbeSignalsRow; } catch { return null; }
}

function fromRow(x: Record<string, unknown>): IdentityRow {
  return {
    id: String(x.id), name: String(x.name), handle: String(x.handle), avdName: String(x.avd_name), serial: String(x.serial),
    consolePort: Number(x.console_port), mcpHostPort: Number(x.mcp_host_port), mcpToken: String(x.mcp_token),
    deviceSlug: String(x.device_slug), appPackage: String(x.app_package), appVersionName: String(x.app_version_name),
    state: x.state as IdentityState, lastError: (x.last_error as string | null) ?? null,
    bannedReason: (x.banned_reason as string | null) ?? null, snapshotTakenAt: (x.snapshot_taken_at as string | null) ?? null,
    paused: Number(x.paused ?? 0) === 1, controlled: Number(x.controlled ?? 0) === 1,
    discardedAt: (x.discarded_at as string | null) ?? null, lastSignals: parseSignals(x.last_signals_json),
    diskBytes: x.disk_bytes === null || x.disk_bytes === undefined ? null : Number(x.disk_bytes),
    bannedAt: (x.banned_at as string | null) ?? null, createdAt: (x.created_at as string | null) ?? null,
    accountClearedAt: (x.account_cleared_at as string | null) ?? null, lockPin: (x.lock_pin as string | null) ?? null,
  };
}

export function getIdentity(db: DatabaseSync, id: string): IdentityRow | null {
  const x = db.prepare('select * from identity where id = ?').get(id) as Record<string, unknown> | undefined;
  return x ? fromRow(x) : null;
}

export function listIdentities(db: DatabaseSync): readonly IdentityRow[] {
  return (db.prepare('select * from identity order by id').all() as Record<string, unknown>[]).map(fromRow);
}

export function setIdentityState(
  db: DatabaseSync, id: string, state: IdentityState,
  patch: { lastError?: string | null; bannedReason?: string | null; snapshotTakenAt?: string | null } = {},
): void {
  // `undefined` mantém a coluna; `null` limpa de fato (coalesce impediria limpar).
  const cols: Record<string, string> = { lastError: 'last_error', bannedReason: 'banned_reason', snapshotTakenAt: 'snapshot_taken_at' };
  const sets = ['state=?', "updated_at=datetime('now')"]; const vals: (string | null)[] = [state];
  for (const [k, col] of Object.entries(cols)) {
    const v = patch[k as keyof typeof patch];
    if (v !== undefined) { sets.push(`${col}=?`); vals.push(v); }
  }
  db.prepare(`update identity set ${sets.join(', ')} where id=?`).run(...vals, id);
}

/** Grava só os campos presentes (`undefined` mantém; `null` limpa). Nunca muta a entrada. */
export function setIdentityFlags(db: DatabaseSync, id: string, f: IdentityFlags): void {
  const cols: readonly [keyof IdentityFlags, string, (v: never) => string | number | null][] = [
    ['paused', 'paused', (v: boolean) => (v ? 1 : 0)],
    ['controlled', 'controlled', (v: boolean) => (v ? 1 : 0)],
    ['discardedAt', 'discarded_at', (v: string | null) => v],
    ['lastSignals', 'last_signals_json', (v: ProbeSignalsRow | null) => (v ? JSON.stringify(v) : null)],
    ['diskBytes', 'disk_bytes', (v: number | null) => v],
    ['handle', 'handle', (v: string) => v],
    ['bannedAt', 'banned_at', (v: string | null) => v],
    ['appVersionName', 'app_version_name', (v: string) => v],
    ['accountClearedAt', 'account_cleared_at', (v: string | null) => v],
    ['lockPin', 'lock_pin', (v: string | null) => v],
  ] as never;
  const sets: string[] = []; const vals: (string | number | null)[] = [];
  for (const [k, col, enc] of cols) {
    const v = f[k];
    if (v !== undefined) { sets.push(`${col}=?`); vals.push(enc(v as never)); }
  }
  if (sets.length === 0) return;
  db.prepare(`update identity set ${sets.join(', ')}, updated_at=datetime('now') where id=?`).run(...vals, id);
}
