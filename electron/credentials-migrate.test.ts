import { describe, expect, it } from 'vitest';
import { migrateLegacyCredentials } from './credentials-migrate';

const legacy = (entries: Record<string, { username: string; password: string }>) => ({
  status: async () => Object.fromEntries(Object.entries(entries).map(([id, e]) => [id, { username: e.username }])),
  get: async (id: string) => entries[id] ?? null,
});

describe('migração do credentials.json para o cofre do daemon', () => {
  it('importa tudo e apaga o arquivo antigo', async () => {
    const posted: unknown[] = []; let removed = false;
    const r = await migrateLegacyCredentials({ legacy: legacy({ conta1: { username: 'u1', password: 'p1' } }), exists: async () => true, remove: async () => { removed = true; }, post: async (_p, b) => { posted.push(b); return { imported: 1 }; } });
    expect(r).toEqual({ migrated: 1 });
    expect(posted).toEqual([{ entries: [{ id: 'conta1', username: 'u1', password: 'p1' }] }]);
    expect(removed).toBe(true);
  });
  it('sem arquivo: nada; import falhou: arquivo fica', async () => {
    expect(await migrateLegacyCredentials({ legacy: legacy({}), exists: async () => false, remove: async () => { throw new Error('não deveria'); }, post: async () => { throw new Error('não deveria'); } })).toEqual({ migrated: 0 });
    let removed = false;
    await expect(migrateLegacyCredentials({ legacy: legacy({ conta1: { username: 'u', password: 'p' } }), exists: async () => true, remove: async () => { removed = true; }, post: async () => { throw new Error('503'); } })).rejects.toThrow('503');
    expect(removed).toBe(false);
  });
});
