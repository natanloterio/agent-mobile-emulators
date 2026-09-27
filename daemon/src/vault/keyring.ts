import { createRequire } from 'node:module';
import { VaultError, type KeySource } from './vault.js';

/** O mínimo de uma entrada do chaveiro que o cofre usa (`Entry` do @napi-rs/keyring). */
export interface KeyEntry { getPassword(): string | null; setPassword(password: string): void }
export type EntryFactory = () => KeyEntry;

const SERVICE = 'enxame';
const ACCOUNT = 'vault';

/**
 * Chaveiro nativo do SO: Credential Manager (Windows), Keychain (macOS), Secret Service/GNOME Keyring/KWallet (Linux).
 * No Linux fica preso ao Secret Service: o keyutils do kernel perderia a chave no reboot.
 * A biblioteca nativa só é carregada no primeiro uso — sem binário para a plataforma, o cofre recusa e o daemon sobe.
 */
const nativeEntry: EntryFactory = () => {
  const { Entry } = createRequire(import.meta.url)('@napi-rs/keyring') as typeof import('@napi-rs/keyring');
  return new Entry(SERVICE, ACCOUNT, { linux: { store: 'secret-service' } });
};

const unavailable = (e: unknown) =>
  e instanceof VaultError ? e : new VaultError(`chaveiro do sistema indisponível: ${String((e as Error)?.message ?? e).slice(0, 160)}`);

/** Chave do cofre (32 bytes em base64) numa entrada do chaveiro do SO. Entrada ausente → null. */
export function keyringKeySource(entry: EntryFactory = nativeEntry): KeySource {
  return {
    load: async () => {
      let b64: string | null;
      try { b64 = entry().getPassword(); } catch (e) { throw unavailable(e); }
      if (!b64) return null;
      const key = Buffer.from(b64, 'base64');
      if (key.length !== 32) throw new VaultError('chave do cofre no chaveiro com tamanho errado');
      return key;
    },
    store: async (key) => {
      try { entry().setPassword(key.toString('base64')); } catch (e) { throw unavailable(e); }
    },
  };
}
