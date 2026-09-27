import type { Vault } from '../vault/vault.js';

/** Entrada do cofre com a chave gravada pelo onboarding (spec onboarding §Arquitetura). */
export const ANTHROPIC_KEY_ENTRY = 'secret:anthropic';
export type ApiKeySource = 'env' | 'vault' | null;

export interface ApiKeyStore {
  /** Chave em uso agora: `ANTHROPIC_API_KEY` do ambiente, senão a do cofre; `''` sem nenhuma. */
  current(): string;
  source(): ApiKeySource;
  /** Lê a do cofre (uma vez na subida). */
  load(): Promise<void>;
  /** Grava no cofre e já passa a valer, sem reiniciar o daemon. */
  set(key: string): Promise<void>;
}

export function createApiKeyStore(o: { readonly envKey: string; readonly vault: Pick<Vault, 'get' | 'put'> }): ApiKeyStore {
  let fromVault = '';
  return {
    current: () => o.envKey || fromVault,
    source: () => (o.envKey ? 'env' : fromVault ? 'vault' : null),
    load: async () => { fromVault = (await o.vault.get(ANTHROPIC_KEY_ENTRY)) ?? ''; },
    set: async (key) => { await o.vault.put(ANTHROPIC_KEY_ENTRY, key, null); fromVault = key; },
  };
}
