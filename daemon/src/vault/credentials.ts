import type { Vault } from './vault.js';

/** Credencial de login do app alvo de uma identidade (spec login determinístico, agora no cofre do daemon). */
export interface Credential { readonly username: string; readonly password: string }
const PREFIX = 'cred:';
export const credentialEntryId = (identityId: string): string => `${PREFIX}${identityId}`;

export async function putCredential(vault: Vault, identityId: string, c: Credential): Promise<void> {
  await vault.put(credentialEntryId(identityId), JSON.stringify({ username: c.username, password: c.password }), c.username);
}

export async function getCredential(vault: Vault, identityId: string): Promise<Credential | null> {
  const raw = await vault.get(credentialEntryId(identityId));
  if (!raw) return null;
  const c = JSON.parse(raw) as Credential;
  return { username: c.username, password: c.password };
}

export async function clearCredential(vault: Vault, identityId: string): Promise<void> {
  await vault.remove(credentialEntryId(identityId));
}

/** Por identidade, só o usuário (guardado em claro como meta da entrada). */
export async function credentialStatus(vault: Vault): Promise<Readonly<Record<string, { readonly username: string }>>> {
  return Object.fromEntries((await vault.list(PREFIX)).map((e) => [e.id.slice(PREFIX.length), { username: e.meta ?? '' }]));
}
