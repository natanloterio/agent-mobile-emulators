import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { secretToolKeySource } from '../src/vault/keyring.js';
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
    expect(statSync(file).mode & 0o777).toBe(0o600);
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
    const broken: KeySource = { load: async () => { throw new VaultError('secret-tool ausente: instale libsecret-tools'); }, store: async () => { throw new VaultError('x'); } };
    const v = createVault({ file, keys: broken });
    await expect(v.put('a', 'b')).rejects.toBeInstanceOf(VaultError);
    expect(await v.available()).toEqual({ ok: false, reason: 'secret-tool ausente: instale libsecret-tools' });
  });
  it('arquivo com entradas mas chave sumiu do chaveiro → VaultError (não cria chave nova por cima)', async () => {
    const file = tmpFile(); const keys = memKeys();
    await createVault({ file, keys }).put('a', 'b');
    keys.stored = null;
    await expect(createVault({ file, keys }).get('a')).rejects.toThrow(/chave do cofre/);
  });
  it('secretToolKeySource: lookup vazio → null; store manda a chave em base64 pelo stdin', async () => {
    const calls: { args: string[]; input?: string }[] = [];
    const run = async (args: string[], input?: string) => { calls.push({ args, input }); return args[0] === 'lookup' ? { code: 1, stdout: '' } : { code: 0, stdout: '' }; };
    const ks = secretToolKeySource(run);
    expect(await ks.load()).toBeNull();
    await ks.store(Buffer.alloc(32, 7));
    expect(calls[1].args).toEqual(['store', '--label=Enxame vault', 'service', 'enxame', 'key', 'vault']);
    expect(Buffer.from(calls[1].input ?? '', 'base64')).toEqual(Buffer.alloc(32, 7));
  });
  it('secretToolKeySource: binário ausente → VaultError', async () => {
    const run = async () => { const e = new Error('spawn secret-tool ENOENT') as Error & { code: string }; e.code = 'ENOENT'; throw e; };
    await expect(secretToolKeySource(run).load()).rejects.toThrow(/secret-tool ausente/);
  });
});
