import { randomBytes } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';

/**
 * Cofre de credenciais do Instagram por identidade (spec login determinístico).
 * A senha fica cifrada pelo `safeStorage` do Electron (chaveiro do SO) em `<userData>/credentials.json`;
 * só o main a decifra, para mandá-la ao daemon. Nada aqui loga a senha nem o objeto que a contém.
 */

/** Subconjunto do `safeStorage` do Electron; `getSelectedStorageBackend` só existe no Linux. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface VaultFs {
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: string, mode: number): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

export interface VaultDeps { readonly safeStorage: SafeStorageLike; readonly file: string; readonly fs?: VaultFs }

export interface Availability { readonly ok: boolean; readonly reason: string | null }
export type CredentialStatus = Readonly<Record<string, { readonly username: string }>>;
export interface Credential { readonly username: string; readonly password: string }

export interface CredentialVault {
  available(): Availability;
  set(id: string, username: string, password: string): Promise<void>;
  /** Só para o main: devolve a senha decifrada. */
  get(id: string): Promise<Credential | null>;
  status(): Promise<CredentialStatus>;
  clear(id: string): Promise<void>;
}

interface Entry { readonly username: string; readonly secret: string }
type Entries = Readonly<Record<string, Entry>>;

export const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const USERNAME_MAX = 100;
const PASSWORD_MAX = 200;
const FILE_MODE = 0o600;

const nodeFs: VaultFs = {
  readFile: (p) => readFile(p, 'utf8'),
  writeFile: (p, d, mode) => writeFile(p, d, { mode, flag: 'wx' }),
  rename,
};

export function assertId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !SAFE_ID.test(id)) throw new Error(`id inválido: ${JSON.stringify(String(id)).slice(0, 80)}`);
}

// Mensagens nunca repetem a senha.
function assertCredential(username: unknown, password: unknown): asserts username is string {
  if (typeof username !== 'string' || username.length < 1 || username.length > USERNAME_MAX || username !== username.trim()) {
    throw new Error(`usuário inválido: 1 a ${USERNAME_MAX} caracteres, sem espaço nas pontas`);
  }
  if (typeof password !== 'string' || password.length < 1 || password.length > PASSWORD_MAX) {
    throw new Error(`senha inválida: 1 a ${PASSWORD_MAX} caracteres`);
  }
}

const isEntry = (v: unknown): v is Entry =>
  typeof v === 'object' && v !== null && typeof (v as Entry).username === 'string' && typeof (v as Entry).secret === 'string';

/** Arquivo ilegível ou com forma errada vale como vazio; entradas inválidas são ignoradas. */
function parseEntries(raw: string): Entries {
  try {
    const doc = JSON.parse(raw) as { version?: unknown; entries?: unknown };
    if (doc?.version !== 1 || typeof doc.entries !== 'object' || doc.entries === null) return {};
    return Object.fromEntries(Object.entries(doc.entries).filter(([id, e]) => SAFE_ID.test(id) && isEntry(e))
      .map(([id, e]) => [id, { username: (e as Entry).username, secret: (e as Entry).secret }]));
  } catch {
    return {};
  }
}

export function createCredentialVault({ safeStorage, file, fs = nodeFs }: VaultDeps): CredentialVault {
  const available = (): Availability => {
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, reason: 'cifragem indisponível: o sistema não oferece chaveiro para guardar a senha' };
    if (safeStorage.getSelectedStorageBackend?.() === 'basic_text') {
      return { ok: false, reason: 'sem chaveiro do sistema (GNOME Keyring ou KWallet): a senha ficaria praticamente em claro, por isso não é guardada' };
    }
    return { ok: true, reason: null };
  };

  const load = (): Promise<Entries> => fs.readFile(file).then(parseEntries, () => ({}));

  // Grava num temporário novo (modo 0600) e renomeia por cima: nunca fica arquivo pela metade.
  const save = async (entries: Entries): Promise<void> => {
    const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ version: 1, entries }, null, 2), FILE_MODE);
    await fs.rename(tmp, file);
  };

  // Leitura-modificação-escrita em fila: duas gravações simultâneas não se perdem.
  let tail: Promise<unknown> = Promise.resolve();
  const mutate = (fn: (e: Entries) => Entries | null): Promise<void> => {
    const next = tail.then(async () => { const cur = await load(); const upd = fn(cur); if (upd) await save(upd); });
    tail = next.catch(() => undefined);
    return next;
  };

  return {
    available,
    set: async (id, username, password) => {
      assertId(id); assertCredential(username, password);
      const a = available();
      if (!a.ok) throw new Error(a.reason ?? 'chaveiro indisponível');
      const secret = safeStorage.encryptString(password).toString('base64');
      await mutate((e) => ({ ...e, [id]: { username, secret } }));
    },
    get: async (id) => {
      assertId(id);
      const e = (await load())[id];
      if (!e) return null;
      try {
        return { username: e.username, password: safeStorage.decryptString(Buffer.from(e.secret, 'base64')) };
      } catch {
        throw new Error(`não foi possível decifrar a senha de ${id}; salve as credenciais de novo`);
      }
    },
    status: async () => Object.fromEntries(Object.entries(await load()).map(([id, e]) => [id, { username: e.username }])),
    clear: async (id) => {
      assertId(id);
      await mutate((e) => (id in e ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== id)) : null));
    },
  };
}
