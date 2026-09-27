import { describe, expect, it, vi } from 'vitest';
import type { CredentialsBridge, LoginResult } from '../live/types';
import { createCredentialActions, type CredentialBridge } from './credentialActions';
import type { FleetAction } from './fleetReducer';

function fakeCreds(over: Partial<CredentialsBridge> = {}) {
  return {
    available: vi.fn(async () => ({ ok: true, reason: null })),
    status: vi.fn(async () => ({ c1: { username: 'loja.sul' } })),
    set: vi.fn(async (_id: string, _u: string, _p: string) => undefined),
    clear: vi.fn(async (_id: string) => undefined),
    ...over,
  };
}
function setup(bridge: CredentialBridge | undefined, confirmAnswer = true) {
  const actions: FleetAction[] = [];
  const confirm = vi.fn((_m: string) => confirmAnswer);
  const created = createCredentialActions({ dispatch: (a) => { actions.push(a); }, getBridge: () => bridge, confirm });
  return { actions, created, confirm };
}
const noPassword = (actions: readonly FleetAction[]) => expect(JSON.stringify(actions)).not.toContain('SENHA-X');

describe('createCredentialActions', () => {
  it('load lê o status e o põe no estado', async () => {
    const credentials = fakeCreds();
    const { actions, created } = setup({ credentials });
    expect(await created.load()).toBe(true);
    expect(actions).toEqual([{ type: 'credentialsLoaded', status: { c1: { username: 'loja.sul' } } }]);
  });

  it('save chama a bridge com o usuário aparado e recarrega o status; a senha não vai ao reducer', async () => {
    const credentials = fakeCreds();
    const { actions, created } = setup({ credentials });
    expect(await created.save('c1', '  loja.sul ', ' SENHA-X ')).toBe(true);
    expect(credentials.set).toHaveBeenCalledWith('c1', 'loja.sul', ' SENHA-X ');
    expect(credentials.status).toHaveBeenCalledTimes(1);
    expect(actions).toEqual([
      { type: 'request', key: 'cred:c1', phase: 'start' }, { type: 'request', key: 'cred:c1', phase: 'ok' },
      { type: 'credentialsLoaded', status: { c1: { username: 'loja.sul' } } },
    ]);
    noPassword(actions);
  });

  it('save sem usuário ou senha nem chama a bridge', async () => {
    const credentials = fakeCreds();
    const { actions, created } = setup({ credentials });
    expect(await created.save('c1', ' ', 'p')).toBe(false);
    expect(await created.save('c1', 'u', '')).toBe(false);
    expect(await created.save('../x', 'u', 'p')).toBe(false);
    expect(credentials.set).not.toHaveBeenCalled();
    expect(actions.map((a) => a.type)).toEqual(['requestError', 'requestError', 'requestError']);
  });

  it('erro do main (ex.: sem chaveiro) aparece legível na linha, sem a senha', async () => {
    const credentials = fakeCreds({ set: vi.fn(() => Promise.reject(new Error("Error invoking remote method 'enxame:credentials:set': Error: sem chaveiro do sistema"))) });
    const { actions, created } = setup({ credentials });
    expect(await created.save('c1', 'u', 'SENHA-X')).toBe(false);
    expect(actions.at(-1)).toEqual({ type: 'requestError', key: 'cred:c1', message: 'sem chaveiro do sistema' });
    noPassword(actions);
  });

  it('prepare: chaveiro ok libera o formulário; sem chaveiro mostra o motivo', async () => {
    const ok = setup({ credentials: fakeCreds() });
    expect(await ok.created.prepare('c1')).toBe(true);
    expect(ok.actions).toEqual([{ type: 'request', key: 'cred:c1', phase: 'ok' }]);
    const no = setup({ credentials: fakeCreds({ available: vi.fn(async () => ({ ok: false, reason: 'sem chaveiro do sistema' })) }) });
    expect(await no.created.prepare('c1')).toBe(false);
    expect(no.actions).toEqual([{ type: 'requestError', key: 'cred:c1', message: 'sem chaveiro do sistema' }]);
  });

  it('forget pede confirmação, limpa e recarrega; recusa não chama nada', async () => {
    const credentials = fakeCreds();
    const no = setup({ credentials }, false);
    expect(await no.created.forget('c1', 'conta1')).toBe(false);
    expect(credentials.clear).not.toHaveBeenCalled();
    const yes = setup({ credentials });
    expect(await yes.created.forget('c1', 'conta1')).toBe(true);
    expect(credentials.clear).toHaveBeenCalledWith('c1');
    expect(yes.confirm.mock.calls[0][0]).toMatch(/conta1/);
    expect(yes.actions.slice(-2)).toEqual([{ type: 'credentialsLoaded', status: { c1: { username: 'loja.sul' } } }, { type: 'loginResult', id: 'c1', result: null }]);
  });

  it.each<[string, LoginResult]>([
    ['logged-in', { outcome: 'logged-in', detail: '' }],
    ['needs-human', { outcome: 'needs-human', detail: 'código por SMS' }],
  ])('login %s: ocupado → resultado na linha', async (_n, result) => {
    const login = vi.fn(async (_id: string) => result);
    const { actions, created } = setup({ credentials: fakeCreds(), login });
    expect(await created.login('c1')).toBe(true);
    expect(login).toHaveBeenCalledWith('c1');
    expect(actions).toEqual([
      { type: 'loginResult', id: 'c1', result: null },
      { type: 'request', key: 'login:c1', phase: 'start' }, { type: 'request', key: 'login:c1', phase: 'ok' },
      { type: 'loginResult', id: 'c1', result },
    ]);
  });

  it('login com erro do main vira mensagem legível', async () => {
    const login = vi.fn(() => Promise.reject(new Error("Error invoking remote method 'enxame:login': Error: sem credenciais salvas para c1")));
    const { actions, created } = setup({ login });
    expect(await created.login('c1')).toBe(false);
    expect(actions.at(-1)).toEqual({ type: 'requestError', key: 'login:c1', message: 'sem credenciais salvas para c1' });
  });

  it('bridge ausente (ou sem o cofre) → erro legível, sem lançar', async () => {
    for (const b of [undefined, {}]) {
      const { actions, created } = setup(b);
      expect(await created.save('c1', 'u', 'p')).toBe(false);
      expect(await created.login('c1')).toBe(false);
      expect(await created.prepare('c1')).toBe(false);
      expect(await created.load()).toBe(false);
      const msgs = actions.filter((a) => a.type === 'requestError').map((a) => (a as { message: string }).message);
      expect(msgs).toEqual(Array(3).fill('cofre de credenciais indisponível nesta versão do app'));
    }
  });
});
