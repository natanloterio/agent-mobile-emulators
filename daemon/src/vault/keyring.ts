import { createRequire } from 'node:module';
import { BRAND, LEGACY_BRAND } from '../brand.js';
import { VaultError, type KeySource } from './vault.js';

/** O mínimo de uma entrada do chaveiro que o cofre usa (`Entry` do @napi-rs/keyring). */
export interface KeyEntry { getPassword(): string | null; setPassword(password: string): void }
export type EntryFactory = () => KeyEntry;

const ACCOUNT = 'vault';

/**
 * Chaveiro nativo do SO: Credential Manager (Windows), Keychain (macOS), Secret Service/GNOME Keyring/KWallet (Linux).
 * No Linux fica preso ao Secret Service: o keyutils do kernel perderia a chave no reboot.
 * A biblioteca nativa só é carregada no primeiro uso — sem binário para a plataforma, o cofre recusa e o daemon sobe.
 */
const nativeEntry = (service: string): EntryFactory => () => {
  const { Entry } = createRequire(import.meta.url)('@napi-rs/keyring') as typeof import('@napi-rs/keyring');
  return new Entry(service, ACCOUNT, { linux: { store: 'secret-service' } });
};

const unavailable = (e: unknown) =>
  e instanceof VaultError ? e : new VaultError(`chaveiro do sistema indisponível: ${String((e as Error)?.message ?? e).slice(0, 160)}`);

function readKey(entry: EntryFactory): Buffer | null {
  let b64: string | null;
  try { b64 = entry().getPassword(); } catch (e) { throw unavailable(e); }
  if (!b64) return null;
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) throw new VaultError('chave do cofre no chaveiro com tamanho errado');
  return key;
}

function writeKey(entry: EntryFactory, key: Buffer): void {
  try { entry().setPassword(key.toString('base64')); } catch (e) { throw unavailable(e); }
}

/**
 * Chave do cofre (32 bytes em base64) numa entrada do chaveiro do SO. Entrada ausente → null.
 * Quem instalou antes da troca de nome tem a chave no serviço `enxame`: ela é copiada para o atual no primeiro load.
 * A antiga fica: uma versão anterior (ou outra cópia do projeto) ainda abre o mesmo cofre com ela.
 */
export function keyringKeySource(entry: EntryFactory = nativeEntry(BRAND), legacy: EntryFactory | null = nativeEntry(LEGACY_BRAND)): KeySource {
  return {
    load: async () => {
      const key = readKey(entry);
      if (key || !legacy) return key;
      const old = readKey(legacy);
      if (!old) return null;
      writeKey(entry, old);
      return old;
    },
    store: async (key) => writeKey(entry, key),
  };
}
