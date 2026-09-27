import type { DatabaseSync } from 'node:sqlite';
import { getIdentity, setIdentityFlags, setIdentityState, type IdentityRow } from '../db/identities.js';
import { getMission, memoryGet } from '../db/missions.js';
import { normalizeHandle } from '../server/routes-identities.js';
import { putCredential } from '../vault/credentials.js';
import type { Vault } from '../vault/vault.js';

export interface PromoteDeps {
  readonly db: DatabaseSync; readonly vault: Vault; readonly snapshot: (identity: IdentityRow) => Promise<void>; readonly now?: () => string;
}
const NO_ACCOUNT = 'sem conta';

/**
 * Missão concluída (spec missões §Promoção): `account.<app alvo>.username` + segredo `account.<app alvo>.password`
 * viram a credencial da identidade; identidade "sem conta" ganha o @, vai a logged-in e tira snapshot.
 */
export async function promoteAccounts(missionId: string, d: PromoteDeps): Promise<boolean> {
  const m = getMission(d.db, missionId); if (!m) return false;
  const identity = getIdentity(d.db, m.identityId); if (!identity) return false;
  const pkg = identity.appPackage;
  const user = memoryGet(d.db, missionId, `account.${pkg}.username`);
  const pass = memoryGet(d.db, missionId, `account.${pkg}.password`);
  if (!user || user.secret || !pass?.secret) return false;
  const password = await d.vault.get(pass.value);
  if (!password) return false;
  await putCredential(d.vault, identity.id, { username: user.value, password });
  const handle = identity.handle === NO_ACCOUNT ? normalizeHandle(user.value) : null;
  if (!handle) return true;
  setIdentityFlags(d.db, identity.id, { handle });
  try {
    await d.snapshot(identity);
    setIdentityState(d.db, identity.id, 'logged-in', { lastError: null, snapshotTakenAt: (d.now ?? (() => new Date().toISOString()))() });
  } catch (e) {
    setIdentityState(d.db, identity.id, 'logged-in', { lastError: `snapshot após missão falhou: ${String((e as Error)?.message ?? e).slice(0, 200)}` });
  }
  return true;
}
