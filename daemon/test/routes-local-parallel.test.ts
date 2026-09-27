import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { openDb } from '../src/db/open.js';
import { createLocalParallelController } from '../src/provider/local-parallel.js';
import { startServer } from '../src/server/api.js';
import { localParallelRoutes } from '../src/server/routes-local-parallel.js';
import { createRuntimeLock } from '../src/swarm/runtime-lock.js';

let stop: (() => Promise<void>) | null = null;
afterEach(async () => { await stop?.(); stop = null; });
const h = { authorization: 'Bearer seg', 'content-type': 'application/json' };

async function mk(o: { idle?: boolean; ollama?: number | null; lmstudio?: number | null } = {}) {
  const db = openDb(':memory:');
  const ollamaCalls: number[] = []; const lmstudioCalls: number[] = [];
  const controller = createLocalParallelController({
    db, isIdle: () => o.idle ?? true, lmstudioEndpoint: 'http://127.0.0.1:1234/v1', lock: createRuntimeLock(),
    ollama: { restartIfParallelDiffers: async (w) => { ollamaCalls.push(w); return o.ollama === undefined ? w : o.ollama; } },
    lmstudio: { reloadIfParallelDiffers: async (_e, w) => { lmstudioCalls.push(w); return o.lmstudio === undefined ? w : o.lmstudio; } },
  });
  const s = await startServer({
    db, port: 0, token: 'seg', onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); },
    onGoal: async () => ({ goalId: 'g', done: Promise.resolve() }), routes: [localParallelRoutes({ controller })],
  });
  stop = s.close;
  const call = (method: string, path: string, body?: unknown) => fetch(`http://127.0.0.1:${s.port}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  return { db, call, s, ollamaCalls, lmstudioCalls, controller };
}

describe('rota de paralelismo local (GET/PUT /settings/local)', () => {
  it('GET sem linha gravada devolve o default (1), nada aplicado, não pendente', async () => {
    const { call } = await mk();
    const r = await call('GET', '/settings/local');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ wanted: 1, applied: { ollama: null, lmstudio: null }, pending: false });
  });
  it('PUT com a frota ociosa grava, aplica nos dois runtimes e devolve o status novo', async () => {
    const { call, ollamaCalls, lmstudioCalls } = await mk({ idle: true });
    const r = await call('PUT', '/settings/local', { parallel: 4 });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ wanted: 4, applied: { ollama: 4, lmstudio: 4 }, pending: false });
    expect(ollamaCalls).toEqual([4]);
    expect(lmstudioCalls).toEqual([4]);
    expect(await (await call('GET', '/settings/local')).json()).toMatchObject({ wanted: 4 });
  });
  it('PUT com a frota ocupada grava mas não mexe nos runtimes; fica pendente', async () => {
    const { call, ollamaCalls, lmstudioCalls } = await mk({ idle: false });
    const r = await call('PUT', '/settings/local', { parallel: 3 });
    expect(await r.json()).toEqual({ wanted: 3, applied: { ollama: null, lmstudio: null }, pending: true });
    expect(ollamaCalls).toEqual([]); expect(lmstudioCalls).toEqual([]);
  });
  it('400: fora de 1..8, não inteiro ou campo desconhecido', async () => {
    const { call } = await mk();
    expect((await call('PUT', '/settings/local', { parallel: 0 })).status).toBe(400);
    expect((await call('PUT', '/settings/local', { parallel: 9 })).status).toBe(400);
    expect((await call('PUT', '/settings/local', { parallel: 1.5 })).status).toBe(400);
    expect((await call('PUT', '/settings/local', { extra: 1 })).status).toBe(400);
  });
  it('PUT ok dispara broadcast do snapshot', async () => {
    const db = openDb(':memory:');
    const controller = createLocalParallelController({
      db, isIdle: () => true, lmstudioEndpoint: 'http://127.0.0.1:1234/v1', lock: createRuntimeLock(),
      ollama: { restartIfParallelDiffers: async (w) => w }, lmstudio: { reloadIfParallelDiffers: async (_e, w) => w },
    });
    const s = await startServer({
      db, port: 0, token: 'seg', onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); },
      onGoal: async () => ({ goalId: 'g', done: Promise.resolve() }), routes: [localParallelRoutes({ controller })],
    });
    stop = s.close;
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws?token=seg`); const msgs: string[] = [];
    await new Promise<void>((r) => { ws.on('message', (m) => { msgs.push(String(m)); if (msgs.length === 1) r(); }); });
    await fetch(`http://127.0.0.1:${s.port}/settings/local`, { method: 'PUT', headers: h, body: JSON.stringify({ parallel: 6 }) });
    await new Promise((r) => setTimeout(r, 80));
    expect(msgs.length).toBe(2);
    ws.close();
  });
});
