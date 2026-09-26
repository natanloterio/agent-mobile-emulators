import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { AdbError } from '../src/device/adb.js';
import { InputError, type InputGesture } from '../src/device/input.js';
import { getIdentity, setIdentityFlags, upsertIdentity } from '../src/db/identities.js';
import { openDb } from '../src/db/open.js';
import { startServer } from '../src/server/api.js';
import { controlRoutes } from '../src/server/routes-control.js';

let stop: (() => Promise<void>) | null = null;
afterEach(async () => { await stop?.(); stop = null; });

const row = { id: 'conta1', name: 'conta1', handle: '@a', avdName: 'x', serial: 'emulator-5554', consolePort: 5554, mcpHostPort: 8080, mcpToken: 't', deviceSlug: 'conta1', appPackage: 'com.instagram.android', appVersionName: '448.0.0.52.84', state: 'idle' as const };
const h = { authorization: 'Bearer seg', 'content-type': 'application/json' };

async function mk(send: (serial: string, g: InputGesture) => Promise<void> = async () => {}) {
  const db = openDb(':memory:'); upsertIdentity(db, row);
  const sent: [string, InputGesture][] = [];
  const input = { send: async (serial: string, g: InputGesture) => { sent.push([serial, g]); await send(serial, g); } };
  const s = await startServer({ db, port: 0, token: 'seg', onGoal: async () => {}, onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); }, routes: [controlRoutes({ input })] });
  stop = s.close;
  const post = (path: string, body: unknown) => fetch(`http://127.0.0.1:${s.port}${path}`, { method: 'POST', headers: h, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { db, s, sent, post };
}

describe('POST /identities/:id/control', () => {
  it('liga e desliga o flag controlled no banco', async () => {
    const { db, post } = await mk();
    const on = await post('/identities/conta1/control', { on: true });
    expect(on.status).toBe(200); expect(await on.json()).toEqual({ id: 'conta1', controlled: true });
    expect(getIdentity(db, 'conta1')?.controlled).toBe(true);
    expect((await post('/identities/conta1/control', { on: false })).status).toBe(200);
    expect(getIdentity(db, 'conta1')?.controlled).toBe(false);
  });
  it('corpo inválido → 400; id desconhecido → 404', async () => {
    const { post } = await mk();
    expect((await post('/identities/conta1/control', { on: 'sim' })).status).toBe(400);
    expect((await post('/identities/conta1/control', 'não é json')).status).toBe(400);
    expect((await post('/identities/nada/control', { on: true })).status).toBe(404);
  });
  it('faz broadcast do snapshot com controlled', async () => {
    const { s, post } = await mk();
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws?token=seg`);
    const msgs: { type: string; data: { identities: { controlled: boolean }[] } }[] = [];
    const second = new Promise<void>((r) => ws.on('message', (m) => { msgs.push(JSON.parse(String(m))); if (msgs.length === 2) r(); }));
    await new Promise<void>((r) => ws.on('open', () => r()));
    await post('/identities/conta1/control', { on: true });
    await second; ws.close();
    expect(msgs[1]).toMatchObject({ type: 'snapshot' }); expect(msgs[1].data.identities[0].controlled).toBe(true);
  });
});

describe('POST /identities/:id/input', () => {
  it('sem controle → 409 e nada é enviado', async () => {
    const { post, sent } = await mk();
    expect((await post('/identities/conta1/input', { kind: 'tap', x: 0.5, y: 0.5 })).status).toBe(409);
    expect(sent).toEqual([]);
  });
  it('com controle → 204 e o gesto vai para o serial da identidade', async () => {
    const { db, post, sent } = await mk();
    setIdentityFlags(db, 'conta1', { controlled: true });
    const r = await post('/identities/conta1/input', { kind: 'key', key: 'back' });
    expect(r.status).toBe(204);
    expect(sent).toEqual([['emulator-5554', { kind: 'key', key: 'back' }]]);
  });
  it('gesto inválido → 400; id desconhecido → 404', async () => {
    const { db, post } = await mk();
    setIdentityFlags(db, 'conta1', { controlled: true });
    expect((await post('/identities/conta1/input', { kind: 'pinch' })).status).toBe(400);
    expect((await post('/identities/conta1/input', { kind: 'key', key: 'power' })).status).toBe(400);
    expect((await post('/identities/nada/input', { kind: 'tap', x: 0, y: 0 })).status).toBe(404);
  });
  it('texto que o device não digita → 400 com a mensagem do InputError', async () => {
    const { db, post } = await mk(async () => { throw new InputError('invalid', 'só ASCII'); });
    setIdentityFlags(db, 'conta1', { controlled: true });
    const r = await post('/identities/conta1/input', { kind: 'text', text: 'ação' });
    expect(r.status).toBe(400); expect(await r.json()).toEqual({ error: 'só ASCII' });
  });
  it('falha do adb → 502 com a mensagem', async () => {
    const { db, post } = await mk(async () => { throw new AdbError('device-missing', "device 'emulator-5554' not found"); });
    setIdentityFlags(db, 'conta1', { controlled: true });
    const r = await post('/identities/conta1/input', { kind: 'tap', x: 0.1, y: 0.2 });
    expect(r.status).toBe(502); expect(await r.json()).toEqual({ error: "device 'emulator-5554' not found" });
  });
  it('outras rotas seguem para o 404 padrão', async () => {
    const { post, s } = await mk();
    expect((await post('/identities/conta1/outra', {})).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${s.port}/identities/conta1/control`, { headers: h })).status).toBe(404);
  });
});
