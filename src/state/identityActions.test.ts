import { describe, expect, it, vi } from 'vitest';
import type { FleetAction } from './fleetReducer';
import { createIdentityActions } from './identityActions';
import type { ApiBridge } from './apiRequest';

function setup(bridge: ApiBridge | undefined, confirmAnswer = true) {
  const actions: FleetAction[] = [];
  const confirm = vi.fn((_msg: string) => confirmAnswer);
  const created = createIdentityActions({ dispatch: (a) => { actions.push(a); }, getBridge: () => bridge, confirm });
  return { actions, created, confirm };
}
const okApi = () => vi.fn((_m: string, _p: string, _b?: unknown) => Promise.resolve(null as unknown));

describe('createIdentityActions — rotas §3.2', () => {
  it.each([
    ['boot com janela', (a: ReturnType<typeof setup>['created']) => a.boot('c1', true), '/identities/c1/boot', { window: true }],
    ['boot sem janela', (a: ReturnType<typeof setup>['created']) => a.boot('c1', false), '/identities/c1/boot', { window: false }],
    ['pause', (a: ReturnType<typeof setup>['created']) => a.pause('c1', true), '/identities/c1/pause', { paused: true }],
    ['resolve', (a: ReturnType<typeof setup>['created']) => a.resolve('c1'), '/identities/c1/resolve', undefined],
    ['rebaseline', (a: ReturnType<typeof setup>['created']) => a.rebaseline('c1'), '/identities/c1/rebaseline', undefined],
    ['control', (a: ReturnType<typeof setup>['created']) => a.setControl('c1', true), '/identities/c1/control', { on: true }],
    ['provision', (a: ReturnType<typeof setup>['created']) => a.provision(), '/identities', {}],
  ])('%s chama a rota certa e marca ocupado → ok', async (_n, run, path, body) => {
    const api = okApi();
    const { actions, created } = setup({ api });
    expect(await run(created)).toBe(true);
    expect(api).toHaveBeenCalledWith('POST', path, body);
    const key = path === '/identities' ? 'provision' : 'id:c1';
    expect(actions).toEqual([{ type: 'request', key, phase: 'start' }, { type: 'request', key, phase: 'ok' }]);
  });

  it('erro da rota vira mensagem legível na chave da identidade', async () => {
    const api = vi.fn(() => Promise.reject(new Error(`Error invoking remote method 'enxame:api': Error: /identities/c1/restore → 409: {"error":"restore-unsafe: confirme"}`)));
    const { actions, created } = setup({ api });
    expect(await created.restore('c1', 'conta1')).toBe(false);
    expect(actions.at(-1)).toEqual({ type: 'requestError', key: 'id:c1', message: 'restore-unsafe: confirme' });
  });

  it('sem bridge não chama nada e avisa que o daemon não está conectado', async () => {
    const { actions, created } = setup(undefined);
    expect(await created.resolve('c1')).toBe(false);
    expect(actions).toEqual([{ type: 'requestError', key: 'id:c1', message: 'daemon não conectado' }]);
  });

  it('discard, restore e ban pedem confirmação; recusa não chama a rota', async () => {
    const api = okApi();
    const no = setup({ api }, false);
    expect(await no.created.discard('c1', 'conta1')).toBe(false);
    expect(await no.created.restore('c1', 'conta1')).toBe(false);
    expect(await no.created.ban('c1', 'conta1', 'checkpoint')).toBe(false);
    expect(api).not.toHaveBeenCalled(); expect(no.actions).toEqual([]); expect(no.confirm).toHaveBeenCalledTimes(3);
    const yes = setup({ api });
    await yes.created.discard('c1', 'conta1');
    await yes.created.restore('c1', 'conta1');
    await yes.created.ban('c1', 'conta1', 'checkpoint');
    expect(api.mock.calls).toEqual([
      ['POST', '/identities/c1/discard', undefined],
      ['POST', '/identities/c1/restore', { confirm: true }],
      ['POST', '/identities/c1/ban', { reason: 'checkpoint' }],
    ]);
    expect(yes.confirm.mock.calls[2][0]).toMatch(/conta1.*checkpoint/s);
  });

  it('ban sem erro atual usa um motivo padrão', async () => {
    const api = okApi();
    await setup({ api }).created.ban('c1', 'conta1', '  ');
    expect(api).toHaveBeenCalledWith('POST', '/identities/c1/ban', { reason: 'marcada como banida pelo operador' });
  });

  it('loginDone exige handle e o normaliza com @', async () => {
    const api = okApi();
    const { actions, created } = setup({ api });
    expect(await created.loginDone('c1', '   ')).toBe(false);
    expect(actions).toEqual([{ type: 'requestError', key: 'id:c1', message: 'informe o @ da conta' }]);
    await created.loginDone('c1', ' loja.sul ');
    expect(api).toHaveBeenCalledWith('POST', '/identities/c1/login-done', { handle: '@loja.sul' });
  });

  it('input usa chave própria (não trava os botões) e manda o gesto cru', async () => {
    const api = okApi();
    const { actions, created } = setup({ api });
    await created.input('c1', { kind: 'tap', x: 0.5, y: 0.25 });
    expect(api).toHaveBeenCalledWith('POST', '/identities/c1/input', { kind: 'tap', x: 0.5, y: 0.25 });
    expect(actions.every((a) => 'key' in a && a.key === 'input:c1')).toBe(true);
  });

  it('id com caractere fora da lista é recusado antes da bridge', async () => {
    const api = okApi();
    const { actions, created } = setup({ api });
    expect(await created.resolve('../kill')).toBe(false);
    expect(api).not.toHaveBeenCalled();
    expect(actions[0]).toMatchObject({ type: 'requestError' });
  });
});

describe('input em fila (integrador)', () => {
  it('o segundo gesto só é enviado depois do primeiro responder', async () => {
    const order: string[] = []; let release!: () => void;
    const first = new Promise<void>((r) => { release = r; });
    const api = vi.fn(async (_m: string, _p: string, g: unknown) => {
      const k = (g as { kind: string }).kind; order.push(`start ${k}`);
      if (k === 'text') await first;
      order.push(`end ${k}`); return null;
    });
    const a = createIdentityActions({ dispatch: () => undefined, getBridge: () => ({ api }) as never, confirm: () => true });
    const p1 = a.input('c1', { kind: 'text', text: 'oi' }); const p2 = a.input('c1', { kind: 'key', key: 'enter' });
    await new Promise((r) => setTimeout(r, 5));
    expect(order).toEqual(['start text']);
    release(); await Promise.all([p1, p2]);
    expect(order).toEqual(['start text', 'end text', 'start key', 'end key']);
  });
});
