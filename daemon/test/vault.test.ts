import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { keyringKeySource } from '../src/vault/keyring.js';
import { createVault, VaultError, type KeySource } from '../src/vault/vault.js';

const memKeys = (): KeySource & { stored: Buffer | null } => {
  const k = { stored: null as Buffer | null, load: async () => k.stored, store: async (b: Buffer) => { k.stored = b; } };
  return k;
};
const tmpFile = () => path.join(mkdtempSync(path.join(os.tmpdir(), 'vault-')), 'vault.json');

describe('cofre do daemon', () => {
  it('cifra, decifra, lista por prefixo com meta e remove; arquivo 0600 sem o valor em claro', async () => {
    const file = tmpFile(); const keys = memKeys();
    const v = createVault({ file, keys });
    await v.put('cred:conta2', '{"username":"u","password":"S3gr3d0!xyz"}', 'u');
    await v.put('mission:m1:email.password', 'Outra$enha123');
    expect(await v.get('cred:conta2')).toBe('{"username":"u","password":"S3gr3d0!xyz"}');
    expect(await v.list('cred:')).toEqual([{ id: 'cred:conta2', meta: 'u' }]);
    const raw = readFileSync(file, 'utf8');
    expect(raw).not.toContain('S3gr3d0'); expect(raw).not.toContain('Outra$enha');
    // Windows não tem modos POSIX (0600); a checagem de permissão só vale em Linux/macOS.
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(keys.stored?.length).toBe(32);
    await v.remove('cred:conta2');
    expect(await v.get('cred:conta2')).toBeNull();
  });
  it('um segundo cofre com a mesma chave lê o que o primeiro gravou', async () => {
    const file = tmpFile(); const keys = memKeys();
    await createVault({ file, keys }).put('a', 'valor-a');
    expect(await createVault({ file, keys }).get('a')).toBe('valor-a');
  });
  it('chaveiro indisponível → VaultError e available() explica, sem gravar nada', async () => {
    const file = tmpFile();
    const broken: KeySource = { load: async () => { throw new VaultError('chaveiro do sistema indisponível: travado'); }, store: async () => { throw new VaultError('x'); } };
    const v = createVault({ file, keys: broken });
    await expect(v.put('a', 'b')).rejects.toBeInstanceOf(VaultError);
    expect(await v.available()).toEqual({ ok: false, reason: 'chaveiro do sistema indisponível: travado' });
  });
  it('arquivo com entradas mas chave sumiu do chaveiro → VaultError (não cria chave nova por cima)', async () => {
    const file = tmpFile(); const keys = memKeys();
    await createVault({ file, keys }).put('a', 'b');
    keys.stored = null;
    await expect(createVault({ file, keys }).get('a')).rejects.toThrow(/chave do cofre/);
  });
  it('keyringKeySource: sem entrada → null; store guarda a chave em base64 e load a devolve', async () => {
    let saved: string | null = null;
    const ks = keyringKeySource(() => ({ getPassword: () => saved, setPassword: (p: string) => { saved = p; } }));
    expect(await ks.load()).toBeNull();
    await ks.store(Buffer.alloc(32, 7));
    expect(Buffer.from(saved ?? '', 'base64')).toEqual(Buffer.alloc(32, 7));
    expect(await ks.load()).toEqual(Buffer.alloc(32, 7));
  });
  it('keyringKeySource: chaveiro travado/inacessível ou biblioteca nativa ausente → VaultError', async () => {
    const locked = keyringKeySource(() => ({ getPassword: () => { throw new Error('Platform secure storage failure: locked'); }, setPassword: () => { throw new Error('locked'); } }));
    await expect(locked.load()).rejects.toThrow(/chaveiro do sistema indisponível/);
    await expect(locked.store(Buffer.alloc(32))).rejects.toBeInstanceOf(VaultError);
    const noNative = keyringKeySource(() => { throw new Error('Cannot find native binding'); });
    await expect(noNative.load()).rejects.toBeInstanceOf(VaultError);
  });
  it('keyringKeySource: valor no chaveiro com tamanho errado → VaultError', async () => {
    const ks = keyringKeySource(() => ({ getPassword: () => Buffer.alloc(16).toString('base64'), setPassword: () => undefined }));
    await expect(ks.load()).rejects.toThrow(/tamanho errado/);
  });
  it('readFile com erro de permissão → put rejeita, nada gravado', async () => {
    const file = tmpFile(); const keys = memKeys();
    let writes = 0, renames = 0;
    const failFs = {
      readFile: async () => { const e = new Error('Permission denied') as Error & { code?: string }; e.code = 'EACCES'; throw e; },
      writeFile: async () => { writes++; },
      rename: async () => { renames++; },
    };
    const v = createVault({ file, keys, fs: failFs });
    await expect(v.put('a', 'secret')).rejects.toBeInstanceOf(VaultError);
    expect(writes).toBe(0); expect(renames).toBe(0);
  });
  it('arquivo com lixo dentro → get/put rejeitam, arquivo não é alterado', async () => {
    const file = tmpFile(); const keys = memKeys();
    const garbage = 'not json at all!!!';
    let writeCount = 0, renameCount = 0;
    const badFs = {
      readFile: async () => garbage,
      writeFile: async () => { writeCount++; },
      rename: async () => { renameCount++; },
    };
    const v = createVault({ file, keys, fs: badFs });
    await expect(v.get('a')).rejects.toBeInstanceOf(VaultError);
    await expect(v.put('b', 'value')).rejects.toBeInstanceOf(VaultError);
    expect(writeCount).toBe(0); expect(renameCount).toBe(0);
  });
});
