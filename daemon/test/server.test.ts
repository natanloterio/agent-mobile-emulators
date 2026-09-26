import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { openDb } from '../src/db/open.js';
import { upsertIdentity } from '../src/db/identities.js';
import { startServer } from '../src/server/api.js';

let stop: (() => Promise<void>) | null = null;
afterEach(async () => { await stop?.(); stop = null; });

const row = { id: 'conta1', name: 'conta1', handle: '@a', avdName: 'x', serial: 'emulator-5554', consolePort: 5554, mcpHostPort: 8080, mcpToken: 't', deviceSlug: 'conta1', appPackage: 'com.instagram.android', appVersionName: '448.0.0.52.84', state: 'idle' as const };

describe('servidor do daemon', () => {
  it('GET /state exige bearer e devolve snapshot', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const s = await startServer({ db, port: 0, token: 'seg', onGoal: async () => {}, onKill: () => {} }); stop = s.close;
    expect((await fetch(`http://127.0.0.1:${s.port}/state`)).status).toBe(401);
    const r = await fetch(`http://127.0.0.1:${s.port}/state`, { headers: { authorization: 'Bearer seg' } });
    const body = await r.json() as { identities: { id: string; state: string }[] };
    expect(body.identities[0]).toMatchObject({ id: 'conta1', state: 'idle' });
  });
  it('POST /goals valida corpo e chama onGoal; POST /kill chama onKill', async () => {
    const db = openDb(':memory:'); const goals: string[] = []; let killed = false;
    const s = await startServer({ db, port: 0, token: 'seg', onGoal: async (t) => { goals.push(t); }, onKill: () => { killed = true; } }); stop = s.close;
    const h = { authorization: 'Bearer seg', 'content-type': 'application/json' };
    expect((await fetch(`http://127.0.0.1:${s.port}/goals`, { method: 'POST', headers: h, body: '{}' })).status).toBe(400);
    expect((await fetch(`http://127.0.0.1:${s.port}/goals`, { method: 'POST', headers: h, body: JSON.stringify({ text: 'Levantar comentários' }) })).status).toBe(202);
    expect((await fetch(`http://127.0.0.1:${s.port}/kill`, { method: 'POST', headers: h })).status).toBe(200);
    expect(goals).toEqual(['Levantar comentários']); expect(killed).toBe(true);
  });
  it('WS recebe snapshot no connect e a cada broadcast', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const s = await startServer({ db, port: 0, token: 'seg', onGoal: async () => {}, onKill: () => {} }); stop = s.close;
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws?token=seg`);
    const msgs: string[] = [];
    await new Promise<void>((r) => { ws.on('message', (m) => { msgs.push(String(m)); if (msgs.length === 2) r(); }); ws.on('open', () => s.broadcast()); });
    expect(JSON.parse(msgs[0]).type).toBe('snapshot'); ws.close();
  });
});

describe('servidor — revisão final (I11)', () => {
  it('segundo POST /goals enquanto um roda → 409; kill/resume refletem no snapshot', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
    const s = await startServer({ db, port: 0, token: 'seg', onGoal: () => gate, onKill: () => {} }); stop = s.close;
    const h = { authorization: 'Bearer seg', 'content-type': 'application/json' };
    const body = JSON.stringify({ text: 'objetivo um' });
    expect((await fetch(`http://127.0.0.1:${s.port}/goals`, { method: 'POST', headers: h, body })).status).toBe(202);
    expect((await fetch(`http://127.0.0.1:${s.port}/goals`, { method: 'POST', headers: h, body })).status).toBe(409);
    await fetch(`http://127.0.0.1:${s.port}/kill`, { method: 'POST', headers: h });
    expect(s.isKilled()).toBe(true);
    expect(((await (await fetch(`http://127.0.0.1:${s.port}/state`, { headers: h })).json()) as { killed: boolean }).killed).toBe(true);
    await fetch(`http://127.0.0.1:${s.port}/resume`, { method: 'POST', headers: h });
    expect(s.isKilled()).toBe(false);
    release(); await new Promise((r) => setTimeout(r, 10));
    expect((await fetch(`http://127.0.0.1:${s.port}/goals`, { method: 'POST', headers: h, body })).status).toBe(202);
  });
});
