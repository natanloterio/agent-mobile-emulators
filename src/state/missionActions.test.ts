import { describe, expect, it } from 'vitest';
import { createMissionActions, MISSION_START_KEY, missionKey } from './missionActions';

function mk(confirmAnswer = true) {
  const calls: { method: string; path: string; body?: unknown }[] = []; const actions: unknown[] = [];
  const bridge = { api: async (method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) => { calls.push({ method, path, body }); return { goalId: 'm1' }; } };
  const a = createMissionActions({ dispatch: (x) => actions.push(x), getBridge: () => bridge, confirm: () => confirmAnswer, getLocale: () => 'en' });
  return { a, calls, actions };
}

describe('missionActions', () => {
  it('start manda identidade, texto aparado e idioma; devolve true', async () => {
    const t = mk();
    expect(await t.a.start('conta2', '  crie um e-mail  ')).toBe(true);
    expect(t.calls).toEqual([{ method: 'POST', path: '/missions', body: { identityId: 'conta2', text: 'crie um e-mail', lang: 'en' } }]);
    expect(t.actions).toContainEqual({ type: 'request', key: MISSION_START_KEY, phase: 'ok' });
  });
  it('texto curto não chama o daemon', async () => {
    const t = mk();
    expect(await t.a.start('conta2', 'ab')).toBe(false);
    expect(t.calls).toEqual([]);
  });
  it('ações vão para /missions/:id/<ação>; abandonar pede confirmação', async () => {
    const t = mk(false);
    await t.a.act('m1', 'continue');
    await t.a.act('m1', 'abandon', 'missão x');
    expect(t.calls).toEqual([{ method: 'POST', path: '/missions/m1/continue', body: undefined }]);
    expect(t.actions).toContainEqual({ type: 'request', key: missionKey('m1'), phase: 'ok' });
  });
  it('instruct manda texto aparado para /missions/:id/instruct; vazio não chama o daemon', async () => {
    const t = mk();
    await t.a.instruct('m1', '  use o YopMail  ');
    expect(t.calls).toEqual([{ method: 'POST', path: '/missions/m1/instruct', body: { text: 'use o YopMail' } }]);
    expect(t.actions).toContainEqual({ type: 'request', key: missionKey('m1'), phase: 'ok' });
    await t.a.instruct('m1', '   ');
    expect(t.calls).toHaveLength(1);
  });
  it('instruct com `then` manda junto no corpo', async () => {
    const t = mk();
    await t.a.instruct('m1', 'toque em reenviar', 'continue');
    expect(t.calls).toEqual([{ method: 'POST', path: '/missions/m1/instruct', body: { text: 'toque em reenviar', then: 'continue' } }]);
  });
});
