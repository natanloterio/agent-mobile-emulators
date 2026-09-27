import { describe, expect, it } from 'vitest';
import { ANTHROPIC_KEY_ENTRY, createApiKeyStore } from '../src/provider/api-key.js';

const KEY = 'sk-ant-' + 'x'.repeat(30);
function memVault(initial: Record<string, string> = {}) {
  let entries = { ...initial };
  return {
    get: async (id: string) => entries[id] ?? null,
    put: async (id: string, value: string) => { entries = { ...entries, [id]: value }; },
    dump: () => entries,
  };
}

describe('createApiKeyStore', () => {
  it('chave do ambiente vence a do cofre', async () => {
    const s = createApiKeyStore({ envKey: KEY, vault: memVault({ [ANTHROPIC_KEY_ENTRY]: 'sk-ant-outra-chave-bem-longa' }) });
    await s.load();
    expect(s.current()).toBe(KEY);
    expect(s.source()).toBe('env');
  });
  it('sem ambiente, usa a do cofre depois de load()', async () => {
    const s = createApiKeyStore({ envKey: '', vault: memVault({ [ANTHROPIC_KEY_ENTRY]: KEY }) });
    expect(s.current()).toBe('');
    await s.load();
    expect(s.current()).toBe(KEY);
    expect(s.source()).toBe('vault');
  });
  it('set grava no cofre e já vale, sem reiniciar', async () => {
    const vault = memVault();
    const s = createApiKeyStore({ envKey: '', vault });
    expect(s.source()).toBeNull();
    await s.set(KEY);
    expect(s.current()).toBe(KEY);
    expect(vault.dump()).toEqual({ [ANTHROPIC_KEY_ENTRY]: KEY });
  });
});
