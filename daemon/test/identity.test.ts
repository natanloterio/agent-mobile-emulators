import { describe, expect, it } from 'vitest';
import type { Adb } from '../src/device/adb.js';
import { openDb } from '../src/db/open.js';
import { getIdentity, upsertIdentity } from '../src/db/identities.js';
import { ensureIdentityReady, prepareIdentityDevice } from '../src/fleet/identity.js';

const row = { id: 'conta1', name: 'conta1', handle: '@a', avdName: 'x', serial: 'emulator-5554', consolePort: 5554, mcpHostPort: 8080, mcpToken: 'tok', deviceSlug: 'conta1', appPackage: 'com.instagram.android', appVersionName: '448.0.0.52.84', state: 'logged-in' as const };
const adbSpy = () => {
  const calls: string[] = [];
  const adb: Adb = {
    devices: async () => ['emulator-5554'], getprop: async () => '1', settingsGetSecure: async () => '', versionName: async () => '448.0.0.52.84',
    forward: async (s, h, d) => { calls.push(`forward ${s} ${h} ${d}`); },
    forwardRemove: async () => undefined,
    push: async () => undefined,
    pull: async () => undefined,
    shellSpawn: () => ({ pid: 1, kill: () => true, on: () => undefined }), shell: async () => '',
    broadcastConfigure: async (_s, e) => { calls.push(`configure ${Object.keys(e).sort().join(',')}`); },
    startTrampoline: async (_s, a) => { calls.push(`trampoline ${a}`); },
    screencap: async () => Buffer.alloc(0), emu: async () => 'OK', trimCaches: async () => undefined,
  };
  return { adb, calls };
};
const readyProbe = async () => ({ ready: true, signals: { bootCompleted: true, accessibility: true, mcpInitialize: true, toolsPresent: true, versionMatch: true }, details: [], failureClass: null });
const versionProbe = async () => ({ ready: false, signals: { bootCompleted: true, accessibility: true, mcpInitialize: true, toolsPresent: true, versionMatch: false }, details: ['versionName 449 ≠ 448'], failureClass: 'version' as const });

describe('prepareIdentityDevice', () => {
  it('prepara o device mesmo em needs-human (pedido explícito da pessoa) e não grava estado', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, { ...row, state: 'needs-human' });
    const { adb, calls } = adbSpy();
    const r = await prepareIdentityDevice({ ...row, state: 'needs-human' }, { adb, probe: readyProbe, unlock: async () => 'already' });
    expect(r.ready).toBe(true);
    expect(calls[0]).toBe('forward emulator-5554 8080 tcp:8080');
    expect(getIdentity(db, 'conta1')?.state).toBe('needs-human');
  });
});

describe('ensureIdentityReady', () => {
  it('refaz forward, aplica slug e token por broadcast e marca idle quando pronta', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const { adb, calls } = adbSpy();
    const r = await ensureIdentityReady(db, row, { adb, probe: readyProbe });
    expect(r.ready).toBe(true);
    expect(calls).toContain('forward emulator-5554 8080 tcp:8080');
    expect(calls).toContain('configure bearer_token,bearer_token_enabled,device_slug');
    expect(getIdentity(db, 'conta1')?.state).toBe('idle');
  });
  it('versão divergente → offline com last_error, sem lançar', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const r = await ensureIdentityReady(db, row, { adb: adbSpy().adb, probe: versionProbe });
    expect(r.ready).toBe(false);
    const got = getIdentity(db, 'conta1');
    expect(got?.state).toBe('offline');
    expect(got?.lastError).toContain('449');
  });
});

describe('ensureIdentityReady — revisão final (I7, I8)', () => {
  it('I7: forward que lança vira offline/infra, sem propagar', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const { adb } = adbSpy();
    const boom: Adb = { ...adb, forward: async () => { throw new Error("adb: device 'emulator-5554' not found"); } };
    const r = await ensureIdentityReady(db, row, { adb: boom, probe: readyProbe });
    expect(r.ready).toBe(false); expect(r.failureClass).toBe('infra');
    expect(getIdentity(db, 'conta1')?.state).toBe('offline');
  });
  it('I8: identidade em needs-human é recusada sem tocar no device', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, { ...row, state: 'needs-human' });
    const { adb, calls } = adbSpy();
    const r = await ensureIdentityReady(db, getIdentity(db, 'conta1')!, { adb, probe: readyProbe });
    expect(r.ready).toBe(false); expect(r.failureClass).toBe('blocked');
    expect(calls).toHaveLength(0);
    expect(getIdentity(db, 'conta1')?.state).toBe('needs-human');
  });
});

describe('ensureIdentityReady — slug exige reinício do servidor MCP', () => {
  const toolsMissing = { ready: false, signals: { bootCompleted: true, accessibility: true, mcpInitialize: true, toolsPresent: false, versionMatch: true }, details: ['tools ausentes: android_conta1_get_screen_state'], failureClass: 'infra' as const };
  it('servidor no ar sem as tools do prefixo → reinicia via trampoline, re-sonda e fica idle', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const { adb, calls } = adbSpy();
    let n = 0;
    const probe = async () => (++n === 1 ? toolsMissing : readyProbe());
    const r = await ensureIdentityReady(db, row, { adb, probe, sleep: async () => {} });
    expect(r.ready).toBe(true);
    expect(calls.filter((c) => c.startsWith('trampoline') || c.startsWith('configure'))).toEqual(['configure bearer_token,bearer_token_enabled,device_slug', 'configure bearer_token,bearer_token_enabled,device_slug', 'trampoline stop', 'trampoline start']);
    expect(n).toBeGreaterThanOrEqual(2);
    expect(getIdentity(db, 'conta1')?.state).toBe('idle');
  });
  it('reinicia no máximo uma vez; se continuar sem as tools, offline com o motivo', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const { adb, calls } = adbSpy();
    const r = await ensureIdentityReady(db, row, { adb, probe: async () => toolsMissing, sleep: async () => {} });
    expect(r.ready).toBe(false);
    expect(calls.filter((c) => c === 'trampoline start')).toHaveLength(1);
    expect(getIdentity(db, 'conta1')?.state).toBe('offline');
    expect(getIdentity(db, 'conta1')?.lastError).toMatch(/tools ausentes/);
  });
});

describe('ensureIdentityReady destrava com o PIN (integrador)', () => {
  it('chama o desbloqueio antes da sonda; falha do desbloqueio vira offline com o motivo', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const order: string[] = [];
    const { adb } = adbSpy();
    const ok = await ensureIdentityReady(db, getIdentity(db, 'conta1')!, { adb, unlock: async () => { order.push('unlock'); }, probe: async () => { order.push('probe'); return readyProbe(); } });
    expect(order).toEqual(['unlock', 'probe']); expect(ok.ready).toBe(true);
    const bad = await ensureIdentityReady(db, getIdentity(db, 'conta1')!, { adb, unlock: async () => { throw new Error('device bloqueado e identidade sem PIN registrado'); } });
    expect(bad.ready).toBe(false);
    expect(getIdentity(db, 'conta1')).toMatchObject({ state: 'offline', lastError: expect.stringMatching(/sem PIN/) });
  });
});

describe('PIN recusado não é tentado de novo (integrador)', () => {
  it('vira needs-human, e a próxima sonda nem toca no device', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const { adb } = adbSpy(); let attempts = 0;
    const unlock = async () => { attempts += 1; throw new Error('PIN recusado ou teclado de desbloqueio não apareceu'); };
    await ensureIdentityReady(db, getIdentity(db, 'conta1')!, { adb, unlock });
    expect(getIdentity(db, 'conta1')?.state).toBe('needs-human');
    await ensureIdentityReady(db, getIdentity(db, 'conta1')!, { adb, unlock });
    expect(attempts).toBe(1);
  });
});

describe('token velho no servidor MCP (integrador: clone herda o token da base)', () => {
  it('401 do MCP reinicia o servidor para ele ler o token novo, e a sonda passa', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const { adb, calls } = adbSpy(); let n = 0;
    const unauthorized = { ready: false, signals: { bootCompleted: true, accessibility: true, mcpInitialize: false, toolsPresent: false, versionMatch: true },
      details: ['MCP: MCP HTTP Transport Error: POSTing to endpoint (HTTP 401): {"error":"unauthorized"}'], failureClass: 'infra' as const };
    const probe = async () => (++n === 1 ? unauthorized : readyProbe());
    const r = await ensureIdentityReady(db, row, { adb, probe, sleep: async () => {}, unlock: async () => {} });
    expect(r.ready).toBe(true);
    expect(calls.filter((c) => c.startsWith('trampoline') || c.startsWith('configure'))).toEqual(['configure bearer_token,bearer_token_enabled,device_slug', 'configure bearer_token,bearer_token_enabled,device_slug', 'trampoline stop', 'trampoline start']);
  });
});
