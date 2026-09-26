import type { DatabaseSync } from 'node:sqlite';

export type IdentityState =
  | 'blank' | 'provisioned' | 'logged-in' | 'running' | 'dirty' | 'restored' | 'banned'
  | 'offline' | 'needs-human' | 'idle';

export interface IdentityRow {
  readonly id: string; readonly name: string; readonly handle: string; readonly avdName: string; readonly serial: string;
  readonly consolePort: number; readonly mcpHostPort: number; readonly mcpToken: string; readonly deviceSlug: string;
  readonly appPackage: string; readonly appVersionName: string; readonly state: IdentityState;
  readonly lastError?: string | null; readonly bannedReason?: string | null; readonly snapshotTakenAt?: string | null;
}

const COLS = ['id','name','handle','avd_name','serial','console_port','mcp_host_port','mcp_token','device_slug','app_package','app_version_name','state'] as const;

export function upsertIdentity(db: DatabaseSync, r: IdentityRow): void {
  const sets = COLS.filter((c) => c !== 'id').map((c) => `${c}=excluded.${c}`).join(', ');
  db.prepare(`insert into identity (${COLS.join(',')}) values (${COLS.map(() => '?').join(',')})
    on conflict(id) do update set ${sets}, updated_at=datetime('now')`)
    .run(r.id, r.name, r.handle, r.avdName, r.serial, r.consolePort, r.mcpHostPort, r.mcpToken, r.deviceSlug, r.appPackage, r.appVersionName, r.state);
}

function fromRow(x: Record<string, unknown>): IdentityRow {
  return {
    id: String(x.id), name: String(x.name), handle: String(x.handle), avdName: String(x.avd_name), serial: String(x.serial),
    consolePort: Number(x.console_port), mcpHostPort: Number(x.mcp_host_port), mcpToken: String(x.mcp_token),
    deviceSlug: String(x.device_slug), appPackage: String(x.app_package), appVersionName: String(x.app_version_name),
    state: x.state as IdentityState, lastError: (x.last_error as string | null) ?? null,
    bannedReason: (x.banned_reason as string | null) ?? null, snapshotTakenAt: (x.snapshot_taken_at as string | null) ?? null,
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
