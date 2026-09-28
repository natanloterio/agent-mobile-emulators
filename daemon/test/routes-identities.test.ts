import { IDLE_PREP, writeBasePrep } from '../src/db/base-settings.js';
import { afterEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '../src/db/open.js';
import { getIdentity, setIdentityState, upsertIdentity, type IdentityRow } from '../src/db/identities.js';
import { createMission } from '../src/db/missions.js';
import type { ProbeResult } from '../src/device/probe.js';
import { startServer } from '../src/server/api.js';
import { createIdentityRoutes, normalizeHandle, type IdentityOps } from '../src/server/routes-identities.js';

const conta1: IdentityRow = { id: 'conta1', name: 'conta1', handle: '@p1', avdName: 'mcp_test_playstore', serial: 'emulator-5554', consolePort: 5554, mcpHostPort: 8080, mcpToken: 'tok1', deviceSlug: 'conta1', appPackage: 'com.instagram.android', appVersionName: '448.0.0.52.84', state: 'idle' };
const READY: ProbeResult = { ready: true, signals: { bootCompleted: true, accessibility: true, mcpInitialize: true, toolsPresent: true, versionMatch: true }, details: [], failureClass: null };
const NOT_READY: ProbeResult = { ready: false, signals: { ...READY.signals, mcpInitialize: false }, details: ['MCP: recusado'], failureClass: 'infra' };
const NOW = new Date('2026-09-26T12:00:00Z');

const closers: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(closers.splice(0).map((c) => c())); });

function harness(over: Partial<IdentityOps> = {}, online: string[] = ['emulator-5554']) {
  const db = openDb(':memory:'); upsertIdentity(db, conta1);
  const log: string[] = []; const devices = [...online];
  const ops: IdentityOps = {
    adb: {
      devices: async () => devices,
      emu: async (s, a) => { log.push(`emu ${s} ${a.join(' ')}`); if (a[0] === 'kill') devices.splice(devices.indexOf(s), 1); return 'OK'; },
      trimCaches: async (s) => { log.push(`trim ${s}`); },
      versionName: async () => '450.0.0.1',
    },
    clone: async (name) => { log.push(`clone ${name}`); },
    deleteAvd: async (name) => { log.push(`delete ${name}`); },
    boot: async (id) => { log.push(`boot ${id.id}`); return id; },
    leasePorts: async () => ({ consolePort: 5556, mcpHostPort: 8081 }),
    ensureReady: async (d, id) => { log.push(`probe ${id.id}`); setIdentityState(d, id.id, 'idle', { lastError: null }); return READY; },
    disk: { invalidate: (n) => { log.push(`invalidate ${n}`); } },
    supervisor: { stop: (id) => { log.push(`sup-stop ${id}`); } },
    onIdentitiesChanged: () => { log.push('changed'); },
    now: () => NOW, uuid: () => 'uuid-novo', killSleep: async () => {}, baseAvd: 'golden',
    ...over,
  };
  return { db, ops, log, devices };
}

async function serve(db: DatabaseSync, ops: IdentityOps) {
  const ir = createIdentityRoutes(ops);
  const s = await startServer({ db, port: 0, token: 'seg', onGoal: async () => {}, onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); }, routes: [ir.route] });
  closers.push(s.close);
  const post = async (p: string, body?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${s.port}${p}`, { method: 'POST', headers: { authorization: 'Bearer seg', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) as Record<string, unknown> : null };
  };
  return { post, settle: ir.settle, booting: ir.booting };
}

describe('handle', () => {
  it('normaliza com @ e valida', () => {
    expect(normalizeHandle('p1t41a.meta_x')).toBe('@p1t41a.meta_x');
    expect(normalizeHandle('@abc')).toBe('@abc');
    expect(normalizeHandle('a b')).toBeNull();
    expect(normalizeHandle('@' + 'a'.repeat(31))).toBeNull();
  });
});

describe('POST /identities', () => {
  it('provisiona contaN livre: lease, token novo, clone do AVD-base e 201 com a linha do snapshot', async () => {
    const h = harness(); const s = await serve(h.db, h.ops);
    const r = await s.post('/identities', {});
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ id: 'conta2', name: 'conta2', handle: 'sem conta', lifecycle: 'provisioned', consolePort: 5556, mcpHostPort: 8081, serial: 'emulator-5556', avdName: 'tapflock_conta2' });
    expect(getIdentity(h.db, 'conta2')).toMatchObject({ mcpToken: 'uuid-novo', deviceSlug: 'conta2', appPackage: 'com.instagram.android', state: 'provisioned' });
    expect(h.log).toContain('clone tapflock_conta2');
  });
  it('nome e handle informados; nome repetido → 409; nome inválido → 400', async () => {
    const h = harness(); const s = await serve(h.db, h.ops);
    const r = await s.post('/identities', { name: 'loja_sp', handle: 'loja.sp' });
    expect(r.status).toBe(201); expect(r.body).toMatchObject({ id: 'loja_sp', handle: '@loja.sp' });
    expect((await s.post('/identities', { name: 'loja_sp' })).status).toBe(409);
    expect((await s.post('/identities', { name: 'a b' })).status).toBe(400);
    expect((await s.post('/identities', { handle: 'x y' })).status).toBe(400);
  });
  it('AVD-base com emulador vivo → 409 e nada clonado', async () => {
    const h = harness({ baseAvd: 'mcp_test_playstore' }); const s = await serve(h.db, h.ops);
    const r = await s.post('/identities', {});
    expect(r.status).toBe(409); expect(String(r.body?.error)).toMatch(/em uso \(emulator-5554\)/);
    expect(h.log.some((l) => l.startsWith('clone'))).toBe(false);
  });
  it('nome "base" é reservado; com o celular-base em preparo, provisionar é recusado sem clonar', async () => {
    const h = harness(); const s = await serve(h.db, h.ops);
    expect((await s.post('/identities', { name: 'base' })).status).toBe(400);
    writeBasePrep(h.db, { ...IDLE_PREP, state: 'running', phase: 'avd' });
    const r = await s.post('/identities', {});
    expect(r.status).toBe(409); expect(String(r.body?.error)).toMatch(/sendo preparado/);
    expect(h.log.some((l) => l.startsWith('clone'))).toBe(false);
  });
  it('accept-version: grava a versão instalada no aparelho como a da identidade e sonda de novo', async () => {
    const h = harness(); const s = await serve(h.db, h.ops);
    const r = await s.post('/identities/conta1/accept-version');
    expect(r.status).toBe(200);
    expect(getIdentity(h.db, 'conta1')?.appVersionName).toBe('450.0.0.1');
    expect(h.log).toContain('probe conta1');
    expect(getIdentity(h.db, 'conta1')?.lastSignals?.versionMatch).toBe(true);
  });
  it('accept-version sem o emulador no adb: 409 e nada muda', async () => {
    const h = harness(); h.devices.splice(0); const s = await serve(h.db, h.ops);
    const before = getIdentity(h.db, 'conta1')?.appVersionName;
    expect((await s.post('/identities/conta1/accept-version')).status).toBe(409);
    expect(getIdentity(h.db, 'conta1')?.appVersionName).toBe(before);
  });
  it('clone falhou → 500 com a mensagem e nada gravado', async () => {
    const h = harness({ clone: async () => { throw new Error('AVD tapflock_conta2 já existe'); } }); const s = await serve(h.db, h.ops);
    const r = await s.post('/identities', {});
    expect(r.status).toBe(500); expect(String(r.body?.error)).toMatch(/já existe/);
    expect(getIdentity(h.db, 'conta2')).toBeNull();
  });
  it('dois provisionamentos simultâneos não pegam o mesmo nome', async () => {
    let n = 0;
    const h = harness({ leasePorts: async () => { n += 1; return { consolePort: 5554 + 2 * n, mcpHostPort: 8080 + n }; } }); const s = await serve(h.db, h.ops);
    const [a, b] = await Promise.all([s.post('/identities', {}), s.post('/identities', {})]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(new Set([a.body?.id, b.body?.id])).toEqual(new Set(['conta2', 'conta3']));
  });
});

describe('ciclo de vida', () => {
  it('404 para id desconhecido; ação desconhecida fica para outra rota (404 do servidor)', async () => {
    const h = harness(); const s = await serve(h.db, h.ops);
    expect((await s.post('/identities/nada/pause', { paused: true })).status).toBe(404);
    expect((await s.post('/identities/conta1/control', { on: true })).status).toBe(404);
  });

  it('boot: 202 e sobe em background; identidade provisionada fica provisioned sem sonda', async () => {
    const h = harness(); const s = await serve(h.db, h.ops);
    await s.post('/identities', {});
    const r = await s.post('/identities/conta2/boot', { window: true });
    expect(r.status).toBe(202);
    await s.settle();
    expect(h.log).toContain('boot conta2'); expect(h.log).not.toContain('probe conta2'); expect(h.log).toContain('changed');
    expect(getIdentity(h.db, 'conta2')?.state).toBe('provisioned');
    // boot anterior falhou (offline) e agora subiu: continua aguardando login, sem sonda
    setIdentityState(h.db, 'conta2', 'offline', { lastError: 'timeout' });
    await s.post('/identities/conta2/boot', {}); await s.settle();
    expect(getIdentity(h.db, 'conta2')).toMatchObject({ state: 'provisioned', lastError: null });
    expect(h.log).not.toContain('probe conta2');
  });
  it('boot: enquanto sobe, a identidade aparece como ligando; segundo Boot no mesmo aparelho é recusado', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const h = harness({ boot: async (id) => { await gate; return id; } }); const s = await serve(h.db, h.ops);
    expect((await s.post('/identities/conta1/boot', {})).status).toBe(202);
    expect([...s.booting()]).toEqual(['conta1']);
    expect((await s.post('/identities/conta1/boot', {})).status).toBe(409);
    release(); await s.settle();
    expect([...s.booting()]).toEqual([]);
  });
  it('shutdown: desliga limpo (adb emu kill), solta o supervisor e deixa offline sem erro', async () => {
    const h = harness(); const s = await serve(h.db, h.ops);
    setIdentityState(h.db, 'conta1', 'idle');
    const r = await s.post('/identities/conta1/shutdown');
    expect(r.status).toBe(200);
    expect(h.log).toContain('emu emulator-5554 kill');
    expect(h.log).toContain('sup-stop conta1');
    expect(getIdentity(h.db, 'conta1')).toMatchObject({ state: 'offline', lastError: null });
    expect(h.devices).not.toContain('emulator-5554');
  });
  it('shutdown recusado com objetivo rodando, ligando, ou já desligado', async () => {
    const h = harness(); const s = await serve(h.db, h.ops);
    setIdentityState(h.db, 'conta1', 'running');
    expect((await s.post('/identities/conta1/shutdown')).status).toBe(409);
    setIdentityState(h.db, 'conta1', 'idle'); h.devices.splice(0);
    expect((await s.post('/identities/conta1/shutdown')).status).toBe(409);
  });
  it('boot de identidade logada roda a sonda; erro de boot vai para last_error + offline', async () => {
    const h = harness({ boot: async () => { throw new Error('emulador não completou o boot em 180 s'); } }); const s = await serve(h.db, h.ops);
    expect((await s.post('/identities/conta1/boot', {})).status).toBe(202);
    await s.settle();
    expect(getIdentity(h.db, 'conta1')).toMatchObject({ state: 'offline', lastError: 'emulador não completou o boot em 180 s' });
    const h2 = harness(); const s2 = await serve(h2.db, h2.ops);
    setIdentityState(h2.db, 'conta1', 'logged-in');
    await s2.post('/identities/conta1/boot', {}); await s2.settle();
    expect(h2.log).toEqual(['boot conta1', 'probe conta1', 'changed']);
  });

  it('login-done: valida handle, logged-in, snapshot salvo e snapshot_taken_at', async () => {
    const h = harness(); const s = await serve(h.db, h.ops);
    expect((await s.post('/identities/conta1/login-done', { handle: 'a b' })).status).toBe(400);
    const r = await s.post('/identities/conta1/login-done', { handle: 'nova.conta' });
    expect(r.status).toBe(200);
    expect(getIdentity(h.db, 'conta1')).toMatchObject({ state: 'logged-in', handle: '@nova.conta', snapshotTakenAt: NOW.toISOString(), lastError: null });
    expect(h.log).toContain('emu emulator-5554 avd snapshot save tapflock');
  });
  it('login-done com snapshot falhando: 200, erro em last_error, sem snapshot_taken_at', async () => {
    const h = harness(); h.ops.adb.emu = async () => { throw new Error('KO: sem espaço'); };
    const s = await serve(h.db, h.ops);
    const r = await s.post('/identities/conta1/login-done', { handle: '@x' });
    expect(r.status).toBe(200);
    expect(getIdentity(h.db, 'conta1')).toMatchObject({ state: 'logged-in', snapshotTakenAt: null, lastError: expect.stringContaining('sem espaço') });
  });

  it('pause, resolve e ban', async () => {
    const h = harness(); const s = await serve(h.db, h.ops);
    expect((await s.post('/identities/conta1/pause', { paused: 'sim' })).status).toBe(400);
    expect((await s.post('/identities/conta1/pause', { paused: true })).status).toBe(200);
    expect(getIdentity(h.db, 'conta1')?.paused).toBe(true);
    expect((await s.post('/identities/conta1/resolve')).status).toBe(409);
    setIdentityState(h.db, 'conta1', 'needs-human', { lastError: 'checkpoint' });
    expect((await s.post('/identities/conta1/resolve')).status).toBe(200);
    expect(getIdentity(h.db, 'conta1')).toMatchObject({ state: 'idle', lastError: null });
    expect((await s.post('/identities/conta1/ban', {})).status).toBe(400);
    expect((await s.post('/identities/conta1/ban', { reason: 'checkpoint permanente' })).status).toBe(200);
    expect(getIdentity(h.db, 'conta1')).toMatchObject({ state: 'banned', bannedReason: 'checkpoint permanente', bannedAt: NOW.toISOString() });
  });

  it('discard: só banned; AVD-base recusado; mata o emulador, apaga o AVD e zera o disco', async () => {
    const h = harness({}, ['emulator-5554', 'emulator-5556']); const s = await serve(h.db, h.ops);
    await s.post('/identities', {});
    expect((await s.post('/identities/conta2/discard')).status).toBe(409);
    await s.post('/identities/conta2/ban', { reason: 'banida' });
    const r = await s.post('/identities/conta2/discard');
    expect(r.status).toBe(200);
    expect(h.log).toEqual(expect.arrayContaining(['emu emulator-5556 kill', 'sup-stop conta2', 'delete tapflock_conta2', 'invalidate tapflock_conta2']));
    expect(h.log.indexOf('emu emulator-5556 kill')).toBeLessThan(h.log.indexOf('delete tapflock_conta2'));
    expect(getIdentity(h.db, 'conta2')).toMatchObject({ discardedAt: NOW.toISOString(), diskBytes: 0, state: 'banned' });
    expect((await s.post('/identities/conta2/discard')).status).toBe(409);
    const hb = harness({ baseAvd: 'mcp_test_playstore' }); const sb = await serve(hb.db, hb.ops);
    await sb.post('/identities/conta1/ban', { reason: 'x' });
    expect((await sb.post('/identities/conta1/discard')).status).toBe(409);
    expect(hb.log).not.toContain('delete mcp_test_playstore');
    expect(h.log).not.toContain('delete mcp_test_playstore');
  });

  it('restore: 409 sem confirmação se restore-unsafe; carrega snapshot, restored, sonda e libera', async () => {
    const h = harness(); const s = await serve(h.db, h.ops);
    setIdentityState(h.db, 'conta1', 'dirty', { snapshotTakenAt: '2026-08-01 00:00:00' });
    const r = await s.post('/identities/conta1/restore', {});
    expect(r).toEqual({ status: 409, body: { error: 'restore-unsafe: confirme' } });
    const ok = await s.post('/identities/conta1/restore', { confirm: true });
    expect(ok.status).toBe(200); expect(ok.body).toMatchObject({ lifecycle: 'restored' });
    await s.settle();
    expect(h.log).toEqual(expect.arrayContaining(['emu emulator-5554 avd snapshot load tapflock', 'probe conta1']));
    expect(getIdentity(h.db, 'conta1')?.state).toBe('idle');
  });
  it('restore com sessão inválida → needs-human; sem snapshot ou fora do adb → 409', async () => {
    const h = harness({ ensureReady: async () => NOT_READY }); const s = await serve(h.db, h.ops);
    expect((await s.post('/identities/conta1/restore', {})).status).toBe(409); // sem snapshot
    setIdentityState(h.db, 'conta1', 'dirty', { snapshotTakenAt: NOW.toISOString() });
    expect((await s.post('/identities/conta1/restore', {})).status).toBe(200);
    await s.settle();
    expect(getIdentity(h.db, 'conta1')).toMatchObject({ state: 'needs-human', lastError: expect.stringContaining('MCP: recusado') });
    const h2 = harness({}, []); const s2 = await serve(h2.db, h2.ops);
    setIdentityState(h2.db, 'conta1', 'dirty', { snapshotTakenAt: NOW.toISOString() });
    expect((await s2.post('/identities/conta1/restore', {})).status).toBe(409);
  });

  it('rebaseline: trim-caches, snapshot save, snapshot_taken_at e cache de disco invalidado', async () => {
    const h = harness(); const s = await serve(h.db, h.ops);
    const r = await s.post('/identities/conta1/rebaseline');
    expect(r.status).toBe(200);
    expect(h.log).toEqual(['trim emulator-5554', 'emu emulator-5554 avd snapshot save tapflock', 'invalidate mcp_test_playstore']);
    expect(getIdentity(h.db, 'conta1')).toMatchObject({ state: 'idle', snapshotTakenAt: NOW.toISOString() });
  });
  it('rebaseline com falha → 500 e erro em last_error; running → 409', async () => {
    const h = harness(); h.ops.adb.trimCaches = async () => { throw new Error('pm falhou'); };
    const s = await serve(h.db, h.ops);
    expect((await s.post('/identities/conta1/rebaseline')).status).toBe(500);
    expect(getIdentity(h.db, 'conta1')).toMatchObject({ lastError: expect.stringContaining('pm falhou'), snapshotTakenAt: null });
    setIdentityState(h.db, 'conta1', 'running');
    expect((await s.post('/identities/conta1/rebaseline')).status).toBe(409);
  });
});

describe('primeiro boot do clone (integrador, spec §4.1: imagem-base sem conta)', () => {
  it('limpa a conta do app alvo só no primeiro boot de uma identidade aguardando login', async () => {
    const cleared: string[] = [];
    const h = harness({ clearAccount: async (id) => { cleared.push(id.serial); } }); const s = await serve(h.db, h.ops);
    await s.post('/identities', { name: 'conta2' }); await s.settle();
    await s.post('/identities/conta2/boot', { window: true }); await s.settle();
    expect(cleared).toEqual(['emulator-5556']);
    expect(getIdentity(h.db, 'conta2')?.accountClearedAt).toBeTruthy();
    await s.post('/identities/conta2/boot', { window: true }); await s.settle();
    expect(cleared).toHaveLength(1);
  });
  it('identidade logada nunca é limpa; falha da limpeza vira offline com o erro', async () => {
    const cleared: string[] = [];
    const h = harness({ clearAccount: async (id) => { cleared.push(id.id); if (id.id === 'conta2') throw new Error('pm clear falhou'); } }); const s = await serve(h.db, h.ops);
    await s.post('/identities/conta1/boot', {}); await s.settle();
    expect(cleared).toEqual([]);
    await s.post('/identities', { name: 'conta2' }); await s.settle();
    await s.post('/identities/conta2/boot', {}); await s.settle();
    expect(getIdentity(h.db, 'conta2')).toMatchObject({ state: 'offline', lastError: expect.stringContaining('pm clear falhou') });
    expect(getIdentity(h.db, 'conta2')?.accountClearedAt).toBeNull();
  });
});

describe('AVD-base em uso sem identidade (integrador)', () => {
  it('emulador aberto por fora com o AVD-base → 409, perguntando o nome ao próprio emulador', async () => {
    const h = harness({}, ['emulator-5554', 'emulator-5570']);
    const ops = { ...h.ops, adb: { ...h.ops.adb, emu: async (s: string, a: readonly string[]) => (a.join(' ') === 'avd name' ? (s === 'emulator-5570' ? 'golden\r\nOK' : 'mcp_test_playstore\nOK') : 'OK') } };
    const s = await serve(h.db, ops);
    const r = await s.post('/identities', { name: 'conta9' });
    expect(r.status).toBe(409); expect(String(r.body?.error)).toMatch(/golden em uso \(emulator-5570\)/);
    expect(h.log.some((l) => l.startsWith('clone'))).toBe(false);
  });
  it('emulador que não responde ao console não bloqueia', async () => {
    const h = harness({}, ['emulator-5570']);
    const ops = { ...h.ops, adb: { ...h.ops.adb, emu: async () => { throw new Error('KO'); } } };
    const s = await serve(h.db, ops);
    expect((await s.post('/identities', { name: 'conta9' })).status).toBe(201);
  });
});

describe('restore espera o device voltar (integrador)', () => {
  it('snapshot load derruba o adb por uns segundos: a sonda só roda com o serial de volta', async () => {
    const h = harness();
    h.db.prepare("update identity set snapshot_taken_at='2026-09-26T11:00:00Z' where id='conta1'").run();
    let polls = 0;
    const ops: IdentityOps = {
      ...h.ops,
      adb: { ...h.ops.adb, emu: async (sr, a) => { h.log.push(`emu ${sr} ${a.join(' ')}`); if (a.includes('load')) h.devices.splice(0); return 'OK'; } },
      killSleep: async () => { polls += 1; if (polls === 2) h.devices.push('emulator-5554'); },
      ensureReady: async (d, id) => { h.log.push(`probe online=${h.devices.includes(id.serial)}`); setIdentityState(d, id.id, 'idle', { lastError: null }); return READY; },
    };
    const s = await serve(h.db, ops);
    expect((await s.post('/identities/conta1/restore', {})).status).toBe(200);
    await s.settle();
    expect(h.log).toContain('probe online=true');
    expect(getIdentity(h.db, 'conta1')?.state).toBe('idle');
  });
});

describe('PIN por identidade (integrador)', () => {
  it('provisionar com PIN: guarda, e o primeiro boot destrava, limpa a conta e aplica o PIN no device', async () => {
    const log: string[] = [];
    const h = harness({
      unlock: async (id) => { log.push(`unlock ${id.id} ${id.lockPin ?? '-'}`); },
      clearAccount: async (id) => { log.push(`clear ${id.id}`); },
      setPin: async (id, pin) => { log.push(`setpin ${id.id} ${pin}`); },
    }); const s = await serve(h.db, h.ops);
    expect((await s.post('/identities', { name: 'conta2', pin: '4321' })).body).toMatchObject({ hasPin: true });
    expect(JSON.stringify((await s.post('/identities', { name: 'conta3', pin: '12' })).body)).toMatch(/PIN/);
    await s.post('/identities/conta2/boot', {}); await s.settle();
    expect(log).toEqual(['unlock conta2 4321', 'clear conta2', 'setpin conta2 4321']);
    expect(getIdentity(h.db, 'conta2')).toMatchObject({ state: 'provisioned', lockPin: '4321' });
  });
  it('sem PIN no corpo usa o default; desbloqueio que falha no boot vira offline com o motivo', async () => {
    const h = harness({ defaultPin: '0000', unlock: async () => { throw new Error('device bloqueado e identidade sem PIN registrado'); } }); const s = await serve(h.db, h.ops);
    await s.post('/identities', { name: 'conta2' }); await s.settle();
    expect(getIdentity(h.db, 'conta2')?.lockPin).toBe('0000');
    await s.post('/identities/conta2/boot', {}); await s.settle();
    expect(getIdentity(h.db, 'conta2')).toMatchObject({ state: 'offline', lastError: expect.stringMatching(/sem PIN/) });
  });
  it('POST /pin: com device no adb só grava se o PIN destravar; valida o formato', async () => {
    const h = harness({ unlock: async (id) => { if (id.lockPin !== '1234') throw new Error('PIN recusado ou teclado de desbloqueio não apareceu'); } }); const s = await serve(h.db, h.ops);
    expect((await s.post('/identities/conta1/pin', { pin: 'abcd' })).status).toBe(400);
    expect((await s.post('/identities/conta1/pin', { pin: '9999' })).status).toBe(409);
    expect(getIdentity(h.db, 'conta1')?.lockPin).toBeNull();
    const ok = await s.post('/identities/conta1/pin', { pin: '1234' });
    expect(ok.status).toBe(200); expect(ok.body).toMatchObject({ hasPin: true }); expect(JSON.stringify(ok.body)).not.toMatch(/1234/);
    expect(getIdentity(h.db, 'conta1')?.lockPin).toBe('1234');
  });
});

describe('POST /identities/:id/login (integrador)', () => {
  const SECRET = 'segredo-XYZ-123';
  it('sucesso: logged-in, handle a partir do username, snapshot salvo; a senha não aparece na resposta', async () => {
    const seen: string[] = [];
    const h = harness({ login: async (_id, c) => { seen.push(c.password); return { outcome: 'logged-in', detail: 'ok' }; } });
    const s = await serve(h.db, h.ops);
    await s.post('/identities', { name: 'conta2' }); await s.settle();
    h.devices.push('emulator-5556');
    const r = await s.post('/identities/conta2/login', { username: 'papaia.me', password: SECRET });
    expect(r).toMatchObject({ status: 200, body: { outcome: 'logged-in' } });
    expect(JSON.stringify(r.body)).not.toContain(SECRET);
    expect(seen).toEqual([SECRET]);
    expect(getIdentity(h.db, 'conta2')).toMatchObject({ state: 'logged-in', handle: '@papaia.me' });
    expect(getIdentity(h.db, 'conta2')?.snapshotTakenAt).toBeTruthy();
  });
  it('desafio → needs-human com o motivo; erro de infra devolve 502 sem a senha e restaura o estado', async () => {
    const h = harness({ login: async () => ({ outcome: 'needs-human', detail: 'Instagram pediu verificação: código' }) }); const s = await serve(h.db, h.ops);
    await s.post('/identities/conta1/login', { username: 'u', password: SECRET });
    expect(getIdentity(h.db, 'conta1')).toMatchObject({ state: 'needs-human', lastError: expect.stringMatching(/verificação/) });
    const h2 = harness({ login: async () => { throw new Error(`falhou digitando ${SECRET}`); } }); const s2 = await serve(h2.db, h2.ops);
    const r = await s2.post('/identities/conta1/login', { username: 'u', password: SECRET });
    expect(r.status).toBe(502); expect(JSON.stringify(r.body)).not.toContain(SECRET);
    expect(getIdentity(h2.db, 'conta1')?.state).toBe('idle');
  });
  it('guardas: corpo inválido 400 sem ecoar; running/controlada/fora do adb 409', async () => {
    const h = harness({ login: async () => ({ outcome: 'logged-in', detail: '' }) }, []); const s = await serve(h.db, h.ops);
    const bad = await s.post('/identities/conta1/login', { username: '', password: SECRET });
    expect(bad.status).toBe(400); expect(JSON.stringify(bad.body)).not.toContain(SECRET);
    expect((await s.post('/identities/conta1/login', { username: 'u', password: 'p' })).status).toBe(409);
  });
  it('corpo vazio usa a credencial do cofre; sem credencial → 409', async () => {
    const seen: { username: string; password: string }[] = [];
    const creds = new Map([['conta1', { username: 'u1', password: 'p1-segredo' }]]);
    const h = harness({ credentials: async (id) => creds.get(id) ?? null, login: async (_i, c) => { seen.push(c); return { outcome: 'logged-in', detail: 'ok' }; } });
    const s = await serve(h.db, h.ops);
    expect((await s.post('/identities/conta1/login', {})).status).toBe(200);
    expect(seen).toEqual([{ username: 'u1', password: 'p1-segredo' }]);
    creds.clear();
    expect((await s.post('/identities/conta1/login', {})).status).toBe(409);
  });
  it('recusado com missão em execução na identidade', async () => {
    const h = harness({ credentials: async () => ({ username: 'u', password: 'p' }), login: async () => ({ outcome: 'logged-in', detail: 'ok' }) });
    createMission(h.db, 'conta1', 'm', 'pt');
    const s = await serve(h.db, h.ops);
    expect((await s.post('/identities/conta1/login', {})).status).toBe(409);
  });
});
