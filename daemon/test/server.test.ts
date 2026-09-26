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
    const s = await startServer({ db, port: 0, token: 'seg', onGoal: async () => {}, onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); } }); stop = s.close;
    expect((await fetch(`http://127.0.0.1:${s.port}/state`)).status).toBe(401);
    const r = await fetch(`http://127.0.0.1:${s.port}/state`, { headers: { authorization: 'Bearer seg' } });
    const body = await r.json() as { identities: { id: string; state: string }[] };
    expect(body.identities[0]).toMatchObject({ id: 'conta1', state: 'idle' });
  });
  it('POST /goals valida corpo e chama onGoal; POST /kill chama onKill', async () => {
    const db = openDb(':memory:'); const goals: string[] = []; let killed = false;
    const s = await startServer({ db, port: 0, token: 'seg', onGoal: async (t) => { goals.push(t); }, onKill: () => { killed = true; }, onProviderTest: async () => { throw new Error('n/a'); } }); stop = s.close;
    const h = { authorization: 'Bearer seg', 'content-type': 'application/json' };
    expect((await fetch(`http://127.0.0.1:${s.port}/goals`, { method: 'POST', headers: h, body: '{}' })).status).toBe(400);
    expect((await fetch(`http://127.0.0.1:${s.port}/goals`, { method: 'POST', headers: h, body: JSON.stringify({ text: 'Levantar comentários' }) })).status).toBe(202);
    expect((await fetch(`http://127.0.0.1:${s.port}/kill`, { method: 'POST', headers: h })).status).toBe(200);
    expect(goals).toEqual(['Levantar comentários']); expect(killed).toBe(true);
  });
  it('WS recebe snapshot no connect e a cada broadcast', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const s = await startServer({ db, port: 0, token: 'seg', onGoal: async () => {}, onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); } }); stop = s.close;
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
    const s = await startServer({ db, port: 0, token: 'seg', onGoal: () => gate, onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); } }); stop = s.close;
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

describe('servidor — provedores (incremento 2)', () => {
  const h = { authorization: 'Bearer seg', 'content-type': 'application/json' };
  const mk = async (db = openDb(':memory:'), onGoal: () => Promise<void> = async () => {}) => {
    const tests: string[] = [];
    const s = await startServer({ db, port: 0, token: 'seg', onGoal, onKill: () => {},
      onProviderTest: async (role) => { tests.push(role); return { role, model: 'm', latencyMs: 1, tokensPerSec: 2, argsValid: true, warning: null, error: null, at: 'x' }; } });
    stop = s.close; return { s, db, tests };
  };
  it('GET /providers devolve config semeada + últimos testes; PUT valida e aplica', async () => {
    const { s } = await mk();
    const g = await (await fetch(`http://127.0.0.1:${s.port}/providers`, { headers: h })).json() as { config: { worker: { mode: string } }; tests: object };
    expect(g.config.worker.mode).toBe('local'); expect(g.config.worker.model).toBe('gpt-oss:20b'); expect(g.tests).toEqual({});
    const put = await fetch(`http://127.0.0.1:${s.port}/providers/worker`, { method: 'PUT', headers: h, body: JSON.stringify({ mode: 'local', model: 'qwen3.5:27b' }) });
    expect(put.status).toBe(200); expect(await put.json()).toMatchObject({ mode: 'local', model: 'qwen3.5:27b', endpoint: 'http://127.0.0.1:11434/v1' });
    expect((await fetch(`http://127.0.0.1:${s.port}/providers/worker`, { method: 'PUT', headers: h, body: JSON.stringify({ mode: 'x' }) })).status).toBe(400);
    expect((await fetch(`http://127.0.0.1:${s.port}/providers/chefe`, { method: 'PUT', headers: h, body: '{}' })).status).toBe(404);
  });
  it('POST /providers/:role/test chama onProviderTest e devolve o resultado; snapshot traz providers', async () => {
    const { s, tests } = await mk();
    const r = await fetch(`http://127.0.0.1:${s.port}/providers/worker/test`, { method: 'POST', headers: h });
    expect(r.status).toBe(200); expect(await r.json()).toMatchObject({ role: 'worker', argsValid: true }); expect(tests).toEqual(['worker']);
    const snap = await (await fetch(`http://127.0.0.1:${s.port}/state`, { headers: h })).json() as { providers: { worker: { mode: string; lastTest: unknown } } };
    expect(snap.providers.worker.mode).toBe('local');
  });
  it('PUT e test → 409 enquanto um objetivo roda (Review Focus 4)', async () => {
    let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
    const { s } = await mk(openDb(':memory:'), () => gate);
    await fetch(`http://127.0.0.1:${s.port}/goals`, { method: 'POST', headers: h, body: JSON.stringify({ text: 'objetivo um' }) });
    expect((await fetch(`http://127.0.0.1:${s.port}/providers/worker`, { method: 'PUT', headers: h, body: JSON.stringify({ model: 'outro' }) })).status).toBe(409);
    expect((await fetch(`http://127.0.0.1:${s.port}/providers/worker/test`, { method: 'POST', headers: h })).status).toBe(409);
    release();
  });
});

describe('servidor — revisão final do incremento 2', () => {
  const h = { authorization: 'Bearer seg', 'content-type': 'application/json' };
  it('PUT /providers dispara broadcast do snapshot com o registro novo (Important 5)', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const s = await startServer({ db, port: 0, token: 'seg', onGoal: async () => {}, onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); } }); stop = s.close;
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws?token=seg`); const msgs: string[] = [];
    await new Promise<void>((r) => { ws.on('message', (m) => { msgs.push(String(m)); if (msgs.length === 1) r(); }); });
    await fetch(`http://127.0.0.1:${s.port}/providers/worker`, { method: 'PUT', headers: h, body: JSON.stringify({ mode: 'nuvem' }) });
    await new Promise((r) => setTimeout(r, 80));
    expect(msgs.length).toBe(2);
    expect((JSON.parse(msgs[1]).data as { providers: { worker: { mode: string; model: string } } }).providers.worker).toMatchObject({ mode: 'nuvem', model: 'claude-haiku-4-5' });
    ws.close();
  });
});

describe('snapshot — incremento 3', () => {
  it('identidade traz earlyStopRemaining da última tarefa', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const { createGoalAndTask, setEarlyStop } = await import('../src/db/tasks.js');
    const { taskId } = createGoalAndTask(db, 'conta1', 'g'); setEarlyStop(db, taskId, 13);
    const s = await startServer({ db, port: 0, token: 'seg', onGoal: async () => {}, onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); } }); stop = s.close;
    const snap = await (await fetch(`http://127.0.0.1:${s.port}/state`, { headers: { authorization: 'Bearer seg' } })).json() as { identities: { earlyStopRemaining: number }[] };
    expect(snap.identities[0].earlyStopRemaining).toBe(13);
  });
});
