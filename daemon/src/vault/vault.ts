import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';

/** Erro do cofre: chaveiro ausente/travado ou chave perdida. A mensagem nunca carrega valor guardado. */
export class VaultError extends Error {}

/** Origem da chave de 32 bytes (produção: chaveiro do SO via secret-tool). `load` → null quando ainda não existe. */
export interface KeySource { load(): Promise<Buffer | null>; store(key: Buffer): Promise<void> }
export interface VaultFs { readFile(p: string): Promise<string>; writeFile(p: string, d: string, mode: number): Promise<void>; rename(a: string, b: string): Promise<void> }
export interface VaultEntryInfo { readonly id: string; readonly meta: string | null }
export interface Vault {
  put(id: string, value: string, meta?: string | null): Promise<void>;
  get(id: string): Promise<string | null>;
  remove(id: string): Promise<void>;
  list(prefix: string): Promise<readonly VaultEntryInfo[]>;
  available(): Promise<{ ok: boolean; reason: string | null }>;
}

interface Entry { readonly iv: string; readonly tag: string; readonly data: string; readonly meta: string | null }
type Entries = Readonly<Record<string, Entry>>;
const FILE_MODE = 0o600;
const ID = /^[A-Za-z0-9_.:@-]{1,200}$/;

const nodeFs: VaultFs = { readFile: (p) => readFile(p, 'utf8'), writeFile: (p, d, mode) => writeFile(p, d, { mode, flag: 'wx' }), rename };

function parse(raw: string): Entries {
  try {
    const doc = JSON.parse(raw) as { version?: unknown; entries?: unknown };
    if (doc?.version !== 1 || typeof doc.entries !== 'object' || doc.entries === null) return {};
    return doc.entries as Entries;
  } catch { return {}; }
}

/**
 * Cofre do daemon (spec missões §Cofre): AES-256-GCM por entrada, chave no chaveiro do SO. Sem chaveiro, recusa —
 * nunca guarda a chave em arquivo. Gravações em fila e atômicas (tmp 0600 + rename).
 */
export function createVault({ file, keys, fs = nodeFs }: { file: string; keys: KeySource; fs?: VaultFs }): Vault {
  let key: Buffer | null = null;
  const load = (): Promise<Entries> => fs.readFile(file).then(parse, () => ({}));
  const save = async (e: Entries) => {
    const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ version: 1, entries: e }), FILE_MODE);
    await fs.rename(tmp, file);
  };
  const getKey = async (create: boolean): Promise<Buffer> => {
    if (key) return key;
    const found = await keys.load();
    if (found) { key = found; return key; }
    if (Object.keys(await load()).length > 0) throw new VaultError('a chave do cofre sumiu do chaveiro; as senhas guardadas não podem ser lidas');
    if (!create) throw new VaultError('cofre ainda sem chave');
    const fresh = randomBytes(32);
    await keys.store(fresh);
    const back = await keys.load();
    if (!back || !back.equals(fresh)) throw new VaultError('o chaveiro não devolveu a chave gravada');
    key = fresh; return key;
  };
  let tail: Promise<unknown> = Promise.resolve();
  const mutate = (fn: (e: Entries) => Promise<Entries | null>): Promise<void> => {
    const next = tail.then(async () => { const cur = await load(); const upd = await fn(cur); if (upd) await save(upd); });
    tail = next.catch(() => undefined);
    return next;
  };
  const assertId = (id: string) => { if (!ID.test(id)) throw new VaultError('id de entrada inválido'); };
  return {
    put: (id, value, meta = null) => { assertId(id); return mutate(async (e) => {
      const k = await getKey(true); const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', k, iv); const data = Buffer.concat([c.update(value, 'utf8'), c.final()]);
      return { ...e, [id]: { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64'), meta } };
    }); },
    get: async (id) => {
      assertId(id);
      const e = (await load())[id];
      if (!e) return null;
      const k = await getKey(false);
      try {
        const d = createDecipheriv('aes-256-gcm', k, Buffer.from(e.iv, 'base64'));
        d.setAuthTag(Buffer.from(e.tag, 'base64'));
        return Buffer.concat([d.update(Buffer.from(e.data, 'base64')), d.final()]).toString('utf8');
      } catch { throw new VaultError(`não foi possível decifrar ${id}`); }
    },
    remove: (id) => { assertId(id); return mutate(async (e) => (id in e ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== id)) : null)); },
    list: async (prefix) => Object.entries(await load()).filter(([id]) => id.startsWith(prefix)).map(([id, e]) => ({ id, meta: e.meta ?? null })),
    available: async () => {
      try { await getKey(true); return { ok: true, reason: null }; }
      catch (e) { return { ok: false, reason: String((e as Error).message ?? e) }; }
    },
  };
}
