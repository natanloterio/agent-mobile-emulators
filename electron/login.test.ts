import { describe, expect, it } from 'vitest';
import { loginViaDaemon } from './login';

describe('loginViaDaemon', () => {
  it('manda corpo vazio: o daemon usa a credencial do próprio cofre', async () => {
    const calls: { path: string; body: unknown }[] = [];
    const r = await loginViaDaemon('conta2', { post: async (path, body) => { calls.push({ path, body }); return { outcome: 'logged-in', detail: 'ok' }; } });
    expect(r).toEqual({ outcome: 'logged-in', detail: 'ok' });
    expect(calls).toEqual([{ path: '/identities/conta2/login', body: {} }]);
  });
  it('id inválido não vira caminho; resposta estranha vira erro', async () => {
    await expect(loginViaDaemon('../kill', { post: async () => ({}) })).rejects.toThrow(/id inválido/);
    await expect(loginViaDaemon('conta2', { post: async () => ({ outcome: 'talvez' }) })).rejects.toThrow(/resposta inesperada/);
  });
});
