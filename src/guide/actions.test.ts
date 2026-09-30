import { describe, expect, it, vi } from 'vitest';
import type { GoalPlan, LiveIdentity, MissionView } from '../live/types';
import { createGuideActions, type GuideBridge, type GuideContext, type GuideLogEntry } from './actions';
import type { GuideUi } from './script';

const account = { id: 'conta1', name: 'conta1' } as LiveIdentity;
const ctx: GuideContext = { snap: null, account };

function plan(ready: boolean): GoalPlan {
  return {
    text: 'ler', pattern: 'fan-out', rationale: '',
    tasks: [{ identityId: 'conta1', name: 'conta1', handle: '@a', instruction: 'ler', signals: null, ready, readyLabel: ready ? 'pronta' : 'versão mudou' }],
    estimate: { tasks: 1, outOfProbe: 0, stepBudget: 30, fleetReadyMs: 0 }, leader: { model: 'm', costUsd: 0, error: null },
  };
}

function setup(bridge: GuideBridge | undefined) {
  const ui: Partial<GuideUi>[] = [];
  const log: GuideLogEntry[] = [];
  const go = vi.fn(); const openAccount = vi.fn();
  const actions = createGuideActions({
    getBridge: () => bridge, getLocale: () => 'pt', testGoalText: () => 'ler comentários',
    setUi: (p) => ui.push(p), log: (e) => log.push(e), go, openAccount,
  });
  return { actions, ui, log, go, openAccount };
}

describe('createGuideActions', () => {
  it('sem daemon: erro legível, sem lançar', async () => {
    const { actions } = setup(undefined);
    expect(await actions.run('base.prepare', ctx)).toEqual({ ok: false, error: 'guide.err.noDaemon' });
  });

  it('preparar o celular-base manda o idioma', async () => {
    const api = vi.fn().mockResolvedValue({ preparing: true });
    const { actions, log } = setup({ api });
    expect((await actions.run('base.prepare', ctx)).ok).toBe(true);
    expect(api).toHaveBeenCalledWith('POST', '/base/prepare', { lang: 'pt' });
    expect(log).toHaveLength(1);
  });

  it('criar celular já liga com janela', async () => {
    const api = vi.fn().mockResolvedValueOnce({ id: 'conta1' }).mockResolvedValueOnce({});
    const { actions } = setup({ api });
    expect((await actions.run('phone.create', ctx)).ok).toBe(true);
    expect(api).toHaveBeenNthCalledWith(1, 'POST', '/identities', {});
    expect(api).toHaveBeenNthCalledWith(2, 'POST', '/identities/conta1/boot', { window: true });
  });

  it('resposta sem id válido não chama boot', async () => {
    const api = vi.fn().mockResolvedValueOnce({ id: '../x' });
    const { actions } = setup({ api });
    expect(await actions.run('phone.create', ctx)).toEqual({ ok: false, error: 'guide.err.badReply' });
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('erro do daemon chega ao cartão', async () => {
    const api = vi.fn().mockRejectedValue(new Error('AVD-base em uso'));
    const { actions } = setup({ api });
    const r = await actions.run('phone.boot', ctx);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('AVD-base em uso');
  });

  it('teste: planeja, só confirma com conta pronta, e lança o plano filtrado', async () => {
    const api = vi.fn().mockResolvedValueOnce(plan(true)).mockResolvedValueOnce({});
    const { actions, ui, log } = setup({ api });
    expect((await actions.run('test.plan', ctx)).ok).toBe(true);
    expect(ui).toEqual([{ test: 'planning' }, { test: 'planned' }]);
    expect(api).toHaveBeenNthCalledWith(1, 'POST', '/goals/plan', { text: 'ler comentários', lang: 'pt' });
    expect((await actions.run('test.start', ctx)).ok).toBe(true);
    expect(api.mock.calls[1]?.[1]).toBe('/goals');
    expect(log.at(-1)?.key).toBe('guide.log.testStarted');
  });

  it('teste: só a conta do Guia entra no plano, mesmo com outras prontas', async () => {
    const two = { ...plan(true), tasks: [{ ...plan(true).tasks[0]!, identityId: 'conta2', name: 'conta2' }, plan(true).tasks[0]!] };
    const api = vi.fn().mockResolvedValueOnce(two).mockResolvedValueOnce({});
    const { actions } = setup({ api });
    await actions.run('test.plan', ctx);
    await actions.run('test.start', ctx);
    const sent = api.mock.calls[1]?.[2] as { plan: GoalPlan };
    expect(sent.plan.tasks.map((t) => t.identityId)).toEqual(['conta1']);
  });

  it('teste: o motivo vem da conta do Guia, não da primeira da lista', async () => {
    const other = { ...plan(false).tasks[0]!, identityId: 'conta2', readyLabel: 'offline' };
    const api = vi.fn().mockResolvedValueOnce({ ...plan(false), tasks: [other, plan(false).tasks[0]!] });
    const { actions } = setup({ api });
    expect(await actions.run('test.plan', ctx)).toEqual({ ok: false, error: 'guide.err.notReady', detail: 'versão mudou' });
  });

  it('pausada e sob controle: devolve ao agente', async () => {
    const api = vi.fn().mockResolvedValue({});
    const { actions } = setup({ api });
    await actions.run('phone.unpause', ctx);
    expect(api).toHaveBeenLastCalledWith('POST', '/identities/conta1/pause', { paused: false });
    await actions.run('phone.release', ctx);
    expect(api).toHaveBeenLastCalledWith('POST', '/identities/conta1/control', { on: false });
  });

  it('missão esperando a pessoa: abre o celular da missão, não o da conta do Guia', async () => {
    const { actions, openAccount } = setup({ api: vi.fn() });
    const mission = { id: 'm-1', identityId: 'conta2', state: 'awaiting-human' } as MissionView;
    await actions.run('human.open', { account, snap: { identities: [], killed: false, updatedAt: '', missions: [mission] } });
    expect(openAccount).toHaveBeenCalledWith('conta2');
  });

  it('teste: conta fora da frota volta ao início com o motivo da sonda', async () => {
    const api = vi.fn().mockResolvedValueOnce(plan(false));
    const { actions, ui } = setup({ api });
    expect(await actions.run('test.plan', ctx)).toEqual({ ok: false, error: 'guide.err.notReady', detail: 'versão mudou' });
    expect(ui.at(-1)).toEqual({ test: 'idle' });
  });

  it('começar sem plano é recusado', async () => {
    const { actions } = setup({ api: vi.fn() });
    expect(await actions.run('test.start', ctx)).toEqual({ ok: false, error: 'guide.err.noPlan' });
  });

  it('resolvido: continua a missão que espera a pessoa; senão resolve a identidade', async () => {
    const api = vi.fn().mockResolvedValue({});
    const { actions } = setup({ api });
    const mission = { id: 'm-1', state: 'awaiting-human' } as MissionView;
    await actions.run('human.resolve', { account, snap: { identities: [], killed: false, updatedAt: '', missions: [mission] } });
    expect(api).toHaveBeenLastCalledWith('POST', '/missions/m-1/continue', undefined);
    await actions.run('human.resolve', ctx);
    expect(api).toHaveBeenLastCalledWith('POST', '/identities/conta1/resolve', undefined);
  });

  it('abrir o celular e ir para a nova missão não chamam o daemon', async () => {
    const api = vi.fn();
    const { actions, openAccount, go } = setup({ api });
    await actions.run('human.open', ctx);
    await actions.run('go.newMission', ctx);
    expect(openAccount).toHaveBeenCalledWith('conta1');
    expect(go).toHaveBeenCalledWith('new');
    expect(api).not.toHaveBeenCalled();
  });

  it('conta Google vai para a ponte do cofre; o registro não leva a senha', async () => {
    const google = vi.fn().mockResolvedValue(undefined);
    const { actions, log } = setup({ base: { google } });
    expect((await actions.submit('google', { email: ' a@b.com ', password: 's3gr3d0' }, ctx)).ok).toBe(true);
    expect(google).toHaveBeenCalledWith('a@b.com', 's3gr3d0');
    expect(JSON.stringify(log)).not.toContain('s3gr3d0');
  });

  it('@ inválido não chega ao daemon; válido grava com @', async () => {
    const api = vi.fn().mockResolvedValue({});
    const { actions, ui } = setup({ api });
    expect(await actions.submit('handle', { handle: 'nome com espaço' }, ctx)).toEqual({ ok: false, error: 'guide.err.handle' });
    expect(api).not.toHaveBeenCalled();
    expect((await actions.submit('handle', { handle: '@@nuvem.cafe' }, ctx)).ok).toBe(true);
    expect(api).toHaveBeenCalledWith('POST', '/identities/conta1/login-done', { handle: '@nuvem.cafe' });
    expect(ui.at(-1)).toEqual({ login: 'ask' });
  });

  it('login pelo Tapflock: guarda, faz login e, se o app pedir verificação, mostra o motivo', async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    const login = vi.fn().mockResolvedValue({ outcome: 'needs-human', detail: 'código por SMS' });
    const credentials = { set, available: vi.fn(), status: vi.fn(), clear: vi.fn() };
    const { actions, log, ui } = setup({ credentials, login });
    const r = await actions.submit('credentials', { username: 'nuvem.cafe', password: 'pw-secreta' }, ctx);
    expect(r).toEqual({ ok: false, error: 'guide.err.loginHuman', detail: 'código por SMS' });
    expect(ui.at(-1)).toEqual({ login: 'ask' });
    expect(set).toHaveBeenCalledWith('conta1', 'nuvem.cafe', 'pw-secreta');
    expect(JSON.stringify(log)).not.toContain('pw-secreta');
  });

  it('sem cofre na ponte: recusa antes de pedir a senha à ponte', async () => {
    const { actions } = setup({ api: vi.fn() });
    expect(await actions.submit('credentials', { username: 'a', password: 'b' }, ctx)).toEqual({ ok: false, error: 'guide.err.noVault' });
  });
});
