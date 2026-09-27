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
  if (entries.length) await d.post('/credentials/import', { entries });
  await d.remove();
  return { migrated: entries.length };
}
