import { describe, expect, it } from 'vitest';
import { createMissionActions, MISSION_START_KEY, missionKey } from './missionActions';

function mk(reply: unknown = { goalId: 'm1' }, confirmAnswer = true) {
  const calls: { method: string; path: string; body?: unknown }[] = []; const actions: unknown[] = [];
  const bridge = { api: async (method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) => { calls.push({ method, path, body }); return reply; } };
  const a = createMissionActions({ dispatch: (x) => actions.push(x), getBridge: () => bridge, confirm: () => confirmAnswer, getLocale: () => 'en' });
  return { a, calls, actions };
}

describe('missionActions', () => {
  it('start manda as identidades, texto aparado e idioma; devolve true quando todas iniciam', async () => {
    const t = mk({ started: [{ identityId: 'conta1', goalId: 'm1' }, { identityId: 'conta2', goalId: 'm2' }], failed: [] });
    expect(await t.a.start(['conta1', 'conta2'], '  abra o youtube  ')).toBe(true);
    expect(t.calls).toEqual([{ method: 'POST', path: '/missions', body: { identityIds: ['conta1', 'conta2'], text: 'abra o youtube', lang: 'en' } }]);
    expect(t.actions).toContainEqual({ type: 'request', key: MISSION_START_KEY, phase: 'ok' });
  });
  it('start com falha parcial mostra quais identidades não iniciaram e devolve false', async () => {
    const t = mk({ started: [{ identityId: 'conta1', goalId: 'm1' }], failed: [{ identityId: 'conta3', error: 'identity paused' }] });
    expect(await t.a.start(['conta1', 'conta3'], 'abra o youtube')).toBe(false);
    expect(t.actions.at(-1)).toEqual({ type: 'requestError', key: MISSION_START_KEY, message: 'Started on conta1. Did not start on: conta3 (identity paused)' });
  });
  it('texto curto ou nenhuma identidade não chama o daemon', async () => {
    const t = mk();
    expect(await t.a.start(['conta2'], 'ab')).toBe(false);
    expect(await t.a.start([], 'abra o youtube')).toBe(false);
    expect(t.calls).toEqual([]);
  });
  it('ações vão para /missions/:id/<ação>; abandonar pede confirmação', async () => {
    const t = mk(undefined, false);
    await t.a.act('m1', 'continue');
    await t.a.act('m1', 'abandon', 'missão x');
    expect(t.calls).toEqual([{ method: 'POST', path: '/missions/m1/continue', body: undefined }]);
    expect(t.actions).toContainEqual({ type: 'request', key: missionKey('m1'), phase: 'ok' });
  });
  it('instruct manda texto aparado para /missions/:id/instruct; vazio não chama o daemon', async () => {
    const t = mk();
    expect(await t.a.instruct('m1', '  use o YopMail  ')).toBe(true);
    expect(t.calls).toEqual([{ method: 'POST', path: '/missions/m1/instruct', body: { text: 'use o YopMail' } }]);
    expect(t.actions).toContainEqual({ type: 'request', key: missionKey('m1'), phase: 'ok' });
    expect(await t.a.instruct('m1', '   ')).toBe(false);
    expect(t.calls).toHaveLength(1);
  });
  it('instruct com `then` manda junto no corpo', async () => {
    const t = mk();
    await t.a.instruct('m1', 'toque em reenviar', 'continue');
    expect(t.calls).toEqual([{ method: 'POST', path: '/missions/m1/instruct', body: { text: 'toque em reenviar', then: 'continue' } }]);
  });
});
