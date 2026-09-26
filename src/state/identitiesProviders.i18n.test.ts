import { describe, expect, it, vi } from 'vitest';
import { testResultFor } from '../data/providers';
import { createI18n, PT } from '../i18n/translate';
import { liveLogFor, liveRoles, mergeLive, testRows } from '../live/merge';
import { track } from './apiRequest';
import type { FleetAction } from './fleetReducer';
import { createInitialState, fleetReducer } from './fleetReducer';
import { liveId } from './fixtures';
import { createIdentityActions } from './identityActions';
import { diskView, selectLiveIdRows, snapshotLabel } from './idRows';
import { selectIdRows, selectRoles } from './selectors';

const en = createI18n('en');
const de = createI18n('de');
const zh = createI18n('zh');
const GiB = 2 ** 30;
const now = new Date(2026, 8, 26, 15, 0).getTime();

describe('identities — idioma das linhas', () => {
  it('snapshot com plural e hora no formato do idioma', () => {
    expect(snapshotLabel(new Date(2026, 8, 25, 23, 0).toISOString(), false, now, en)).toBe('1 day ago');
    expect(snapshotLabel(new Date(2026, 8, 24, 16, 0).toISOString(), false, now, de)).toBe('vor 2 Tagen');
    expect(snapshotLabel(new Date(2026, 8, 25, 10, 0).toISOString(), true, now, en)).toBe('1 day · restore-unsafe');
    expect(snapshotLabel(new Date(2026, 8, 25, 10, 0).toISOString(), true, now)).toBe('1 dia · restore-unsafe');
    expect(snapshotLabel(new Date(2026, 8, 3, 10, 0).toISOString(), true, now, zh)).toBe('23 天 · restore-unsafe');
    expect(snapshotLabel(new Date(2026, 8, 26, 9, 5).toISOString(), false, now, en)).toBe(`today, ${en.fmt.time(new Date(2026, 8, 26, 9, 5))}`);
  });
  it('disco com o decimal do idioma', () => {
    expect(diskView(3.4 * GiB, en).disk).toBe('3.4 / 8 GB');
    expect(diskView(3.4 * GiB, createI18n('fr')).disk).toBe('3,4 / 8 Go');
  });
  it('ações e "sem conta" do modo vivo traduzidas; estado cru fica', () => {
    const [r] = selectLiveIdRows([liveId({ id: 'c0', name: 'c0', handle: '', lifecycle: 'blank', hasPin: false })], {}, now, en);
    expect(r.handle).toBe('no account');
    expect(r.lc).toBe('blank');
    expect(r.actions.map((a) => a.label)).toEqual(['Boot with window', 'Logged in', 'Register PIN']);
  });
  it('demo: ações, snapshot, versão e textos das identidades extras traduzidos', () => {
    const rows = selectIdRows(createInitialState(), 8, en);
    const by = (n: string) => rows.find((x) => x.name === n)!;
    expect(by('conta3').actions).toEqual([{ kind: 'open', label: 'Open device', index: 2 }]);
    expect(by('conta3').snap).toBe('2 days ago');
    expect(by('conta7').version).toBe('449.0 ≠ registered');
    expect(by('conta1').disk).toBe('3.8 / 8 GB');
    expect(by('conta11')).toMatchObject({ snap: 'banned on 09/12', disk: '7.1 / 8 GB held', actions: [{ kind: 'extra', label: 'Free disk', index: 0 }] });
    expect(by('conta12')).toMatchObject({ handle: 'no account', actions: [{ kind: 'extra', label: 'Log in', index: 1 }] });
    const after = selectIdRows(fleetReducer(createInitialState(), { type: 'extraAction', index: 0 }), 8, zh);
    expect(after.find((x) => x.name === 'conta11')?.disk).toBe('0 GB · AVD 已丢弃');
  });
});

describe('identities — ações e mensagens geradas na UI', () => {
  const setup = (lang = en) => {
    const actions: FleetAction[] = [];
    const confirm = vi.fn((_m: string) => false);
    const created = createIdentityActions({ dispatch: (a) => { actions.push(a); }, getBridge: () => undefined, confirm, getI18n: () => lang });
    return { actions, created, confirm };
  };
  it('validação de PIN, @ e id no idioma escolhido', async () => {
    const { actions, created } = setup();
    await created.provision('12');
    await created.loginDone('c1', '  @ ');
    await created.boot('../x', true);
    expect(actions.map((a) => (a.type === 'requestError' ? a.message : ''))).toEqual(['PIN: digits only, 4 to 16', 'enter the account @', 'invalid id: ../x']);
  });
  it('confirmações traduzidas, motivo padrão do ban inclusive', async () => {
    const { created, confirm } = setup(de);
    await created.discard('c1', 'conta1');
    await created.ban('c1', 'conta1', '');
    expect(confirm.mock.calls[0][0]).toBe('Speicher von conta1 freigeben? Das AVD wird endgültig gelöscht.');
    expect(confirm.mock.calls[1][0]).toBe('conta1 als gesperrt markieren?\nGrund: vom Operator als gesperrt markiert\nDie Identität verlässt die Flotte.');
  });
  it('"daemon não conectado" no idioma; sem getI18n segue português', async () => {
    const out: FleetAction[] = [];
    await track({ dispatch: (a) => { out.push(a); }, getBridge: () => undefined, getI18n: () => zh }, 'k', () => undefined);
    await track({ dispatch: (a) => { out.push(a); }, getBridge: () => undefined }, 'k', () => undefined);
    expect(out).toEqual([{ type: 'requestError', key: 'k', message: 'daemon 未连接' }, { type: 'requestError', key: 'k', message: 'daemon não conectado' }]);
  });
  it('o idioma é lido a cada ação (troca no seletor vale sem recriar as ações)', async () => {
    let lang = en;
    const actions: FleetAction[] = [];
    const created = createIdentityActions({ dispatch: (a) => { actions.push(a); }, getBridge: () => undefined, confirm: () => false, getI18n: () => lang });
    await created.registerPin('c1', 'x');
    lang = PT;
    await created.registerPin('c1', 'x');
    expect(actions.map((a) => (a.type === 'requestError' ? a.message : ''))).toEqual(['PIN: digits only, 4 to 16', 'PIN: só dígitos, 4 a 16']);
  });
});

describe('identities — modo vivo (merge)', () => {
  const base = { id: 'c1', name: 'c1', handle: '@a', state: 'running', task: 'Levantar', steps: 1, budget: 30, costUsd: 0, error: '', lastTools: [] };
  it('sufixo degradada, motivo de banimento e tokens do log no idioma', () => {
    const live = { killed: false, updatedAt: 'x', identities: [
      { ...base, degraded: true },
      { ...base, id: 'c2', name: 'c2', bannedReason: 'checkpoint' },
      { ...base, id: 'c3', name: 'c3', lastTools: [{ idx: 1, tool: 't', excerpt: 'x', tokens: 1500, gate: false }] },
    ] };
    const out = mergeLive([], live as never, {}, en);
    expect(out[0].task).toBe('Levantar · degraded');
    expect(out[1].error).toBe('banned: checkpoint');
    expect(liveLogFor(live as never, 'c3', de)[0].tokens).toBe('1,5k tok');
    expect(liveLogFor(live as never, 'c3', en)[0].tokens).toBe('1.5k tok');
  });
});

describe('providers — idioma', () => {
  it('papéis, rótulo do teste e resultado mock traduzidos', () => {
    const roles = selectRoles(createInitialState(), en);
    expect(roles.map((r) => r.name)).toEqual(['Leader', 'Worker per device', 'Escalation']);
    expect(roles[0].testLabel).toBe('Test connection');
    const running = selectRoles(fleetReducer(createInitialState(), { type: 'testStart', role: 'lider' }), zh)[0];
    expect(running.testLabel).toBe('正在 conta1 上运行标准 tool call…');
    expect(testResultFor('nuvem', de).map((x) => [x.label, x.value])).toEqual([
      ['Latenz', '1,2 s'], ['Tokens/s', '64'], ['Argumente', 'strukturiert und gültig'], ['Tool', 'android_conta1_get_screen_state'],
    ]);
  });
  it('resultado real: rótulos traduzidos, erro/aviso do daemon como vieram', () => {
    const t = { role: 'worker', model: 'm', latencyMs: 812, tokensPerSec: 41.3, argsValid: false, warning: 'lento', error: null, at: 'x' } as const;
    expect(testRows(t, en)).toEqual([
      { label: 'Latency', value: '812 ms' }, { label: 'Tokens/s', value: '41.3' }, { label: 'Arguments', value: 'invalid' }, { label: 'Warning', value: 'lento' },
    ]);
    expect(testRows({ ...t, warning: null, argsValid: true }, en)[3]).toEqual({ label: 'Tool', value: 'get_screen_state (canonical tool call)' });
    const snap = { killed: false, updatedAt: 'x', identities: [], providers: { worker: { role: 'worker', mode: 'local', model: 'm', endpoint: 'e', lastTest: { ...t, error: 'auth: key ausente' } } } };
    const out = liveRoles(selectRoles(createInitialState(), zh), snap as never, zh);
    expect(out[1].result?.[3]).toEqual({ label: '错误', value: 'auth: key ausente' });
  });
});
