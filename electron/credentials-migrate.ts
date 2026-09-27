import type { CredentialVault } from './credentials.js';

export interface MigrateDeps {
  readonly legacy: Pick<CredentialVault, 'status' | 'get'>;
  readonly post: (path: string, body: unknown) => Promise<unknown>;
  readonly exists: () => Promise<boolean>;
  readonly remove: () => Promise<void>;
}

/** Leva o `credentials.json` antigo (safeStorage) para o cofre do daemon e apaga o arquivo só depois do import aceito. */
export async function migrateLegacyCredentials(d: MigrateDeps): Promise<{ migrated: number }> {
  if (!(await d.exists())) return { migrated: 0 };
  const ids = Object.keys(await d.legacy.status());
  const entries = (await Promise.all(ids.map(async (id) => { const c = await d.legacy.get(id); return c ? { id, username: c.username, password: c.password } : null; })))
    .filter((e): e is { id: string; username: string; password: string } => e !== null);
  if (entries.length) {
    const r = await d.post('/credentials/import', { entries });
    const imported = typeof (r as { imported?: unknown })?.imported === 'number' ? (r as { imported: number }).imported : 0;
    // Import parcial (ex.: identidade que o daemon não conhece): o arquivo antigo fica para não perder senha.
    if (imported !== entries.length) throw new Error(`o daemon importou ${imported} de ${entries.length} credenciais`);
  }
  await d.remove();
  return { migrated: entries.length };
}

export interface CredentialsResponse {
  readonly available: { readonly ok: boolean; readonly reason: string | null };
  readonly entries: Readonly<Record<string, { readonly username: string }>>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Valida o GET /credentials do daemon antes de repassar à UI (mesma ideia do `isResult` do login). */
export function parseCredentialsResponse(v: unknown): CredentialsResponse {
  const ok = isObj(v) && isObj(v.available) && typeof v.available.ok === 'boolean'
    && (v.available.reason === null || typeof v.available.reason === 'string')
    && isObj(v.entries) && Object.values(v.entries).every((e) => isObj(e) && typeof e.username === 'string');
  if (!ok) throw new Error('resposta inesperada do daemon às credenciais');
  const available = v.available as { ok: boolean; reason: string | null };
  const entries = Object.fromEntries(Object.entries(v.entries as Record<string, { username: string }>).map(([id, e]) => [id, { username: e.username }]));
  return { available: { ok: available.ok, reason: available.reason }, entries };
}
