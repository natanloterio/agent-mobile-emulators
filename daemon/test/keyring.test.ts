import { describe, expect, it } from 'vitest';
import { keyringKeySource, type KeyEntry } from '../src/vault/keyring.js';

const KEY = Buffer.alloc(32, 7);

function fakeEntry(initial: string | null): KeyEntry & { value: string | null } {
  return {
    value: initial,
    getPassword() { return this.value; },
    setPassword(p: string) { this.value = p; },
  };
}

describe('keyringKeySource', () => {
  it('lê e grava a chave na entrada atual', async () => {
    const entry = fakeEntry(null);
    const src = keyringKeySource(() => entry, null);
    expect(await src.load()).toBeNull();
    await src.store(KEY);
    expect(await src.load()).toEqual(KEY);
  });

  it('copia a chave da entrada de antes da troca de nome e mantém a antiga (versão anterior ainda abre o cofre)', async () => {
    const entry = fakeEntry(null);
    const legacy = fakeEntry(KEY.toString('base64'));
    const src = keyringKeySource(() => entry, () => legacy);
    expect(await src.load()).toEqual(KEY);
    expect(entry.value).toBe(KEY.toString('base64'));
    expect(legacy.value).toBe(KEY.toString('base64'));
  });

  it('a entrada atual vence e a antiga fica intocada', async () => {
    const other = Buffer.alloc(32, 9);
    const entry = fakeEntry(other.toString('base64'));
    const legacy = fakeEntry(KEY.toString('base64'));
    expect(await keyringKeySource(() => entry, () => legacy).load()).toEqual(other);
    expect(entry.value).toBe(other.toString('base64'));
  });

  it('chave antiga com tamanho errado não é migrada', async () => {
    const entry = fakeEntry(null);
    const legacy = fakeEntry(Buffer.alloc(8).toString('base64'));
    await expect(keyringKeySource(() => entry, () => legacy).load()).rejects.toThrow('tamanho errado');
    expect(entry.value).toBeNull();
  });

  it('chaveiro travado ao gravar a cópia → VaultError, sem perder a antiga', async () => {
    const entry = { getPassword: () => null, setPassword: () => { throw new Error('locked'); } };
    const legacy = fakeEntry(KEY.toString('base64'));
    await expect(keyringKeySource(() => entry, () => legacy).load()).rejects.toThrow('chaveiro do sistema indisponível');
    expect(legacy.value).toBe(KEY.toString('base64'));
  });
});
