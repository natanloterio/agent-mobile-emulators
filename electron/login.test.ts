import { describe, expect, it, vi } from 'vitest';
import { loginViaDaemon } from './login';

const deps = (cred: { username: string; password: string } | null, response: unknown = { outcome: 'logged-in', detail: 'ok' }) => {
  const get = vi.fn(async (_id: string) => cred);
  const post = vi.fn(async (_path: string, _body: unknown) => response);
  return { get, post };
};

describe('loginViaDaemon', () => {
  it('manda usuário e senha decifrados para a rota da identidade e devolve o resultado', async () => {
    const d = deps({ username: 'loja.sul', password: 'p' }, { outcome: 'needs-human', detail: 'código por SMS' });
    await expect(loginViaDaemon('conta1', d)).resolves.toEqual({ outcome: 'needs-human', detail: 'código por SMS' });
    expect(d.post).toHaveBeenCalledWith('/identities/conta1/login', { username: 'loja.sul', password: 'p' });
  });
  it('sem credencial salva: erro legível e nada vai ao daemon', async () => {
    const d = deps(null);
    await expect(loginViaDaemon('conta1', d)).rejects.toThrow('sem credenciais salvas para conta1');
    expect(d.post).not.toHaveBeenCalled();
  });
  it('id inválido é recusado antes de virar caminho', async () => {
    const d = deps({ username: 'u', password: 'p' });
    await expect(loginViaDaemon('../kill', d)).rejects.toThrow(/id inválido/);
    expect(d.get).not.toHaveBeenCalled(); expect(d.post).not.toHaveBeenCalled();
  });
  it('resposta fora do contrato vira erro, sem repetir a senha', async () => {
    const d = deps({ username: 'u', password: 'SEGREDO' }, { weird: true });
    const e = await loginViaDaemon('conta1', d).catch((x: Error) => x);
    expect((e as Error).message).toMatch(/resposta inesperada/); expect((e as Error).message).not.toContain('SEGREDO');
  });
});
