import { spawn } from 'node:child_process';
import { VaultError, type KeySource } from './vault.js';

export type SecretToolRun = (args: string[], input?: string) => Promise<{ code: number; stdout: string }>;

const ATTRS = ['service', 'enxame', 'key', 'vault'];

const spawnRun: SecretToolRun = (args, input) => new Promise((resolve, reject) => {
  const p = spawn('secret-tool', args, { stdio: ['pipe', 'pipe', 'ignore'] });
  let out = '';
  p.stdout.on('data', (c) => { out += String(c); });
  p.on('error', reject);
  p.on('close', (code) => resolve({ code: code ?? 1, stdout: out }));
  p.stdin.end(input ?? '');
});

const wrap = async <T>(fn: () => Promise<T>): Promise<T> => {
  try { return await fn(); }
  catch (e) {
    if ((e as { code?: string }).code === 'ENOENT') throw new VaultError('secret-tool ausente: instale libsecret-tools');
    throw e instanceof VaultError ? e : new VaultError(`chaveiro indisponível: ${String((e as Error).message ?? e).slice(0, 160)}`);
  }
};

/** Chave do cofre no chaveiro do SO (GNOME Keyring/KWallet via libsecret). Exit 1 no lookup = ainda não existe. */
export function secretToolKeySource(run: SecretToolRun = spawnRun): KeySource {
  return {
    load: () => wrap(async () => {
      const r = await run(['lookup', ...ATTRS]);
      const b64 = r.stdout.trim();
      if (r.code !== 0 || !b64) return null;
      const k = Buffer.from(b64, 'base64');
      if (k.length !== 32) throw new VaultError('chave do cofre no chaveiro com tamanho errado');
      return k;
    }),
    store: (key) => wrap(async () => {
      const r = await run(['store', '--label=Enxame vault', ...ATTRS], key.toString('base64'));
      if (r.code !== 0) throw new VaultError('o chaveiro recusou guardar a chave (está destravado?)');
    }),
  };
}
