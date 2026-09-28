import { describe, expect, it } from 'vitest';
import { createInitialState } from './fleetReducer';
import { liveId } from './fixtures';
import { diskView, lifecycleTone, selectLiveIdRows, snapshotLabel, type RowAction } from './idRows';
import { selectIdRows } from './selectors';

const GiB = 2 ** 30;
const now = new Date(2026, 8, 26, 15, 0).getTime();
const kinds = (a: readonly RowAction[]) => a.map((x) => x.kind);

describe('idRows — colunas reais', () => {
  it('snapshot: —, hoje HH:MM, há N dias, N dias · restore-unsafe', () => {
    expect(snapshotLabel(null, false, now)).toBe('—');
    expect(snapshotLabel(new Date(2026, 8, 26, 9, 5).toISOString(), false, now)).toBe('hoje, 09:05');
    expect(snapshotLabel(new Date(2026, 8, 25, 23, 0).toISOString(), false, now)).toBe('há 1 dia');
    expect(snapshotLabel(new Date(2026, 8, 24, 16, 0).toISOString(), false, now)).toBe('há 2 dias');
    expect(snapshotLabel(new Date(2026, 8, 3, 10, 0).toISOString(), true, now)).toBe('23 dias · restore-unsafe');
    expect(snapshotLabel('lixo', false, now)).toBe('—');
  });
  it('snapshot no formato do SQLite (UTC sem fuso) é lido como UTC', () => {
    const utc = new Date(Date.UTC(2026, 8, 26, 12, 30));
    const hh = String(utc.getHours()).padStart(2, '0'); const mm = String(utc.getMinutes()).padStart(2, '0');
    expect(snapshotLabel('2026-09-26 12:30:00', false, Date.UTC(2026, 8, 26, 12, 31))).toMatch(new RegExp(`${hh}:${mm}$`));
  });
  it('disco em GB com uma casa e barra sobre 8 GiB; null → —', () => {
    expect(diskView(3.4 * GiB)).toEqual({ disk: '3,4 / 8 GB', diskPct: 43, high: false });
    expect(diskView(6 * GiB)).toEqual({ disk: '6,0 / 8 GB', diskPct: 75, high: true });
    expect(diskView(20 * GiB).diskPct).toBe(100);
    expect(diskView(null)).toEqual({ disk: '—', diskPct: 0, high: false });
  });
  it('tom do pill por estado cru do banco', () => {
    expect(lifecycleTone('running')).toBe('green');
    expect(lifecycleTone('needs-human')).toBe('dark'); expect(lifecycleTone('banned')).toBe('dark'); expect(lifecycleTone('dirty')).toBe('dark');
    expect(lifecycleTone('offline')).toBe('grey'); expect(lifecycleTone('idle')).toBe('white'); expect(lifecycleTone('whatever')).toBe('white');
  });
});

describe('selectLiveIdRows — ações por estado', () => {
  const rows = (ls: Parameters<typeof liveId>[0][], requests = {}) =>
    selectLiveIdRows(ls.map((o, i) => liveId({ id: `c${i}`, name: `c${i}`, ...o })), requests, now);

  it('linha traz ciclo cru, app/versão, portas e esmaece descartadas', () => {
    const [r, d] = rows([{ lifecycle: 'idle', diskBytes: 4 * GiB }, { lifecycle: 'banned', discardedAt: '2026-09-20 10:00:00' }]);
    expect(r).toMatchObject({ id: 'c0', lc: 'idle', app: 'Instagram', version: '448.0.0.52.84', ports: '5554 · 8080', disk: '4,0 / 8 GB', dimmed: false });
    expect(d.dimmed).toBe(true); expect(d.actions).toEqual([]);
  });
  it('versão do app diferente da registrada → oferece aceitar a versão instalada', () => {
    const signals = { bootCompleted: true, accessibility: true, mcpInitialize: true, toolsPresent: true, versionMatch: false };
    expect(kinds(rows([{ lifecycle: 'offline', signals }])[0].actions)).toEqual(['boot', 'accept-version']);
    expect(kinds(rows([{ lifecycle: 'idle', signals: { ...signals, versionMatch: true } }])[0].actions)).not.toContain('accept-version');
    // Sonda de um aparelho desligado (tudo false): não é versão mudada, não oferece.
    const off = { bootCompleted: false, accessibility: false, mcpInitialize: false, toolsPresent: false, versionMatch: false };
    expect(kinds(rows([{ lifecycle: 'offline', signals: off }])[0].actions)).not.toContain('accept-version');
  });
  it('blank/provisioned → subir com janela e login feito; offline → subir; needs-human → abrir device', () => {
    expect(kinds(rows([{ lifecycle: 'blank' }])[0].actions)).toEqual(['boot-window', 'login']);
    expect(kinds(rows([{ lifecycle: 'provisioned' }])[0].actions)).toEqual(['boot-window', 'login']);
    expect(kinds(rows([{ lifecycle: 'offline' }])[0].actions)).toEqual(['boot']);
    const needs = rows([{ lifecycle: 'banned', discardedAt: 'x' }, { lifecycle: 'needs-human' }])[1];
    // Índice do tile ignora descartadas (mesma ordem da frota no cockpit).
    expect(needs.actions).toEqual([{ kind: 'open', label: 'Abrir device', index: 0 }]);
  });
  it('banida não descartada → liberar disco; restore-unsafe → confirmar restore; disco > 70% → re-baseline', () => {
    expect(kinds(rows([{ lifecycle: 'banned' }])[0].actions)).toEqual(['discard']);
    expect(kinds(rows([{ lifecycle: 'idle', restoreUnsafe: true, diskBytes: 6 * GiB }])[0].actions)).toEqual(['restore', 'rebaseline']);
    expect(kinds(rows([{ lifecycle: 'idle', diskBytes: 5 * GiB }])[0].actions)).toEqual([]);
  });
  it('handle vazio vira "sem conta"; erro e ocupado vêm da requisição da linha', () => {
    const [r] = rows([{ handle: '' }], { 'id:c0': { busy: true, error: 'boot falhou' } });
    expect(r).toMatchObject({ handle: 'sem conta', busy: true, error: 'boot falhou' });
  });
});

describe('selectIdRows (demo) no formato novo', () => {
  it('mantém as linhas do design com ações open/extra', () => {
    const r = selectIdRows(createInitialState(), 8);
    expect(r.find((x) => x.name === 'conta3')?.actions).toEqual([{ kind: 'open', label: 'Abrir device', index: 2 }]);
    expect(r.find((x) => x.name === 'conta11')?.actions).toEqual([{ kind: 'extra', label: 'Liberar disco', index: 0 }]);
  });
});

describe('Registrar PIN (integrador)', () => {
  it('aparece só quando o daemon diz que não há PIN, nunca em banida', () => {
    const r = (o: Parameters<typeof liveId>[0]) => kinds(selectLiveIdRows([liveId({ id: 'c0', name: 'c0', ...o })], {}, now)[0].actions);
    expect(r({ lifecycle: 'idle', hasPin: false })).toEqual(['pin']);
    expect(r({ lifecycle: 'idle', hasPin: true })).toEqual([]);
    expect(r({ lifecycle: 'idle' })).toEqual([]);
    expect(r({ lifecycle: 'banned', hasPin: false })).toEqual(['discard']);
  });
});

describe('credenciais e login pelo daemon', () => {
  const one = (o: Parameters<typeof liveId>[0], creds: Parameters<typeof selectLiveIdRows>[4], requests = {}) =>
    selectLiveIdRows([liveId({ id: 'c0', name: 'c0', ...o })], requests, now, undefined, creds)[0];
  const saved = { status: { c0: { username: 'loja.sul' } }, results: {} };
  it('sem status carregado (sem cofre) não oferece nada novo', () => {
    expect(kinds(one({ lifecycle: 'blank' }, undefined).actions)).toEqual(['boot-window', 'login']);
  });
  it('sem credencial: só "Credenciais"; com: nome na linha, "Fazer login" nos estados certos e "Esquecer"', () => {
    expect(kinds(one({ lifecycle: 'idle' }, { status: {}, results: {} }).actions)).toEqual(['creds']);
    for (const lc of ['blank', 'provisioned', 'needs-human', 'offline', 'idle', 'logged-in']) expect(kinds(one({ lifecycle: lc }, saved).actions)).toContain('autologin');
    expect(kinds(one({ lifecycle: 'running' }, saved).actions)).not.toContain('autologin');
    expect(kinds(one({ lifecycle: 'idle', controlled: true }, saved).actions)).not.toContain('autologin');
    const idle = one({ lifecycle: 'idle' }, saved);
    expect(kinds(idle.actions)).toEqual(['autologin', 'creds', 'forget']);
    expect(idle.credUser).toBe('loja.sul');
    expect(kinds(one({ lifecycle: 'banned' }, saved).actions)).toEqual(['discard']);
    expect(one({ lifecycle: 'running', discardedAt: 'x' }, saved).actions).toEqual([]);
  });
  it('resultado do login: sucesso em tom ok; needs-human com o detalhe do daemon; ocupado e erro das chaves novas', () => {
    const r = (result: { outcome: 'logged-in' | 'already-logged-in' | 'needs-human'; detail: string }) =>
      one({ lifecycle: 'blank' }, { ...saved, results: { c0: result } }).loginNote;
    expect(r({ outcome: 'logged-in', detail: '' })).toEqual({ tone: 'ok', text: 'Login feito pelo daemon.' });
    expect(r({ outcome: 'already-logged-in', detail: '' })).toEqual({ tone: 'ok', text: 'A conta já estava logada.' });
    expect(r({ outcome: 'needs-human', detail: 'código por SMS' })).toEqual({ tone: 'human', text: 'Precisa de humano: código por SMS' });
    expect(one({ lifecycle: 'blank' }, saved, { 'login:c0': { busy: true, error: null } })).toMatchObject({ busy: true, loginBusy: true });
    expect(one({ lifecycle: 'blank' }, saved, { 'cred:c0': { busy: false, error: 'sem chaveiro' } }).error).toBe('sem chaveiro');
    expect(one({ lifecycle: 'blank' }, saved, { 'login:c0': { busy: false, error: 'sem credenciais' } }).error).toBe('sem credenciais');
  });
});
