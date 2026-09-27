import { createVault, type KeySource, type Vault } from '../../src/vault/vault.js';

/** Cofre em memória: fs falso e chave guardada numa variável (sem chaveiro). */
export function memVault(): Vault {
  const files = new Map<string, string>();
  let key: Buffer | null = null;
  const keys: KeySource = { load: async () => key, store: async (b) => { key = b; } };
  return createVault({
    file: '/v.json',
    keys,
    fs: {
      readFile: async (p) => {
        const v = files.get(p);
        if (v === undefined) throw new Error('ENOENT');
        return v;
      },
      writeFile: async (p, d) => { files.set(p, d); },
      rename: async (a, b) => { files.set(b, files.get(a) ?? ''); files.delete(a); },
    },
  });
}
