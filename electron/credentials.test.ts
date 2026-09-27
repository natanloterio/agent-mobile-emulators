import { mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createCredentialVault, type SafeStorageLike, type VaultFs } from './credentials';

// Cifra falsa e reversível: o bastante para provar que o arquivo não guarda a senha em claro.
const fakeSafe = (over: Partial<SafeStorageLike> = {}): SafeStorageLike => ({
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'gnome_libsecret',
  encryptString: (s) => Buffer.from(`enc:${[...s].reverse().join('')}`),
  decryptString: (b) => [...b.toString().replace(/^enc:/, '')].reverse().join(''),
  ...over,
});

function memFs(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const modes = new Map<string, number>();
  const fs: VaultFs = {
    readFile: async (p) => { const v = files.get(p); if (v === undefined) throw new Error('ENOENT'); return v; },
    writeFile: async (p, d, mode) => { files.set(p, d); modes.set(p, mode); },
    rename: async (a, b) => { const v = files.get(a); if (v === undefined) throw new Error('ENOENT'); files.delete(a); files.set(b, v); modes.set(b, modes.get(a) ?? 0); },
  };
  return { fs, files, modes };
}
const FILE = '/u/credentials.json';
const make = (safe = fakeSafe(), initial: Record<string, string> = {}) => {
  const m = memFs(initial);
  return { ...m, vault: createCredentialVault({ safeStorage: safe, fs: m.fs, file: FILE }) };
};

describe('available', () => {
  it('ok com chaveiro real; recusa basic_text e cifragem indisponível com motivo legível', () => {
    expect(make().vault.available()).toEqual({ ok: true, reason: null });
    const basic = make(fakeSafe({ getSelectedStorageBackend: () => 'basic_text' })).vault.available();
    expect(basic.ok).toBe(false); expect(basic.reason).toMatch(/chaveiro/);
    const off = make(fakeSafe({ isEncryptionAvailable: () => false })).vault.available();
    expect(off.ok).toBe(false); expect(off.reason).toMatch(/cifragem/);
  });
  it('fora do Linux (sem getSelectedStorageBackend) basta a cifragem', () => {
    expect(make(fakeSafe({ getSelectedStorageBackend: undefined })).vault.available().ok).toBe(true);
  });
});

describe('set / get / status / clear', () => {
  it('grava cifrado, em arquivo temporário renomeado, modo 0600; get decifra; status só tem o username', async () => {
    const { vault, files, modes } = make();
    await vault.set('conta1', 'loja.sul', 's3nh@ forte');
    const raw = files.get(FILE)!;
    expect(raw).not.toContain('s3nh@ forte');
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(parsed.entries.conta1.username).toBe('loja.sul');
    expect(Buffer.from(parsed.entries.conta1.secret, 'base64').toString()).toMatch(/^enc:/);
    expect(modes.get(FILE)).toBe(0o600);
    expect([...files.keys()]).toEqual([FILE]); // temporário renomeado, nada sobra
    expect(await vault.get('conta1')).toEqual({ username: 'loja.sul', password: 's3nh@ forte' });
    expect(await vault.get('conta2')).toBeNull();
    expect(await vault.status()).toEqual({ conta1: { username: 'loja.sul' } });
    await vault.set('conta2', 'outra', 'x');
    await vault.clear('conta1');
    expect(await vault.status()).toEqual({ conta2: { username: 'outra' } });
    expect(await vault.get('conta1')).toBeNull();
  });

  it('valida id, username e senha sem repetir a senha na mensagem', async () => {
    const { vault, files } = make();
    await expect(vault.set('../x', 'u', 'p')).rejects.toThrow(/id inválido/);
    await expect(vault.set('c1', '', 'p')).rejects.toThrow(/usuário/);
    await expect(vault.set('c1', ' u', 'p')).rejects.toThrow(/usuário/);
    await expect(vault.set('c1', 'u'.repeat(101), 'p')).rejects.toThrow(/usuário/);
    await expect(vault.set('c1', 'u', '')).rejects.toThrow(/senha/);
    const err = await vault.set('c1', 'u', 'segredo'.repeat(40)).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/senha/); expect((err as Error).message).not.toContain('segredo');
    await expect(vault.get('a/b')).rejects.toThrow(/id inválido/);
    await expect(vault.clear('a b')).rejects.toThrow(/id inválido/);
    expect(files.size).toBe(0);
  });

  it('recusa gravar sem chaveiro real', async () => {
    const { vault, files } = make(fakeSafe({ getSelectedStorageBackend: () => 'basic_text' }));
    await expect(vault.set('c1', 'u', 'p')).rejects.toThrow(/chaveiro/);
    expect(files.size).toBe(0);
  });

  it('arquivo ilegível ou com forma errada vale como vazio, sem lançar', async () => {
    expect(await make(fakeSafe(), { [FILE]: '{lixo' }).vault.status()).toEqual({});
    expect(await make(fakeSafe(), { [FILE]: '{"version":2,"entries":{"c1":{"username":"u","secret":"eA=="}}}' }).vault.status()).toEqual({});
    const mixed = make(fakeSafe(), { [FILE]: JSON.stringify({ version: 1, entries: { ok1: { username: 'u', secret: 'eA==' }, bad: { username: 3 }, '../x': { username: 'u', secret: 'eA==' } } }) });
    expect(await mixed.vault.status()).toEqual({ ok1: { username: 'u' } });
    const { vault } = make(fakeSafe(), { [FILE]: '{lixo' });
    await vault.set('c1', 'u', 'p');
    expect(await vault.status()).toEqual({ c1: { username: 'u' } });
  });

  it('gravações simultâneas não se perdem', async () => {
    const { vault } = make();
    await Promise.all([vault.set('a', 'ua', 'p'), vault.set('b', 'ub', 'p'), vault.set('c', 'uc', 'p')]);
    expect(Object.keys(await vault.status()).sort()).toEqual(['a', 'b', 'c']);
  });

  it('nunca loga a senha', async () => {
    const spies = (['log', 'error', 'warn', 'info', 'debug'] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => undefined));
    const { vault } = make();
    await vault.set('c1', 'u', 'NAO-LOGAR'); await vault.get('c1'); await vault.status(); await vault.clear('c1');
    for (const s of spies) { for (const call of s.mock.calls) expect(JSON.stringify(call)).not.toContain('NAO-LOGAR'); s.mockRestore(); }
  });
});

describe('fs real', () => {
  it('troca um arquivo 0644 por um 0600 e não deixa temporário', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cofre-'));
    const file = path.join(dir, 'credentials.json');
    await writeFile(file, '{lixo', { mode: 0o644 });
    const vault = createCredentialVault({ safeStorage: fakeSafe(), file });
    await vault.set('c1', 'u', 'p');
    // Windows não tem modos POSIX (0600); a checagem de permissão só vale em Linux/macOS.
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(file, 'utf8')).entries.c1.username).toBe('u');
    expect(await readdir(dir)).toEqual(['credentials.json']);
  });
});
