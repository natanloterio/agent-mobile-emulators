import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { CONFIG } from '../src/config.js';
import { openDb } from '../src/db/open.js';
import { startServer } from '../src/server/api.js';
import { settingsRoutes } from '../src/server/routes-settings.js';
import { readGuideCompleted } from '../src/db/settings.js';

let stop: (() => Promise<void>) | null = null;
afterEach(async () => { await stop?.(); stop = null; });
const h = { authorization: 'Bearer seg', 'content-type': 'application/json' };

async function mk() {
  const db = openDb(':memory:');
  const s = await startServer({
    db, port: 0, token: 'seg', onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); },
    onGoal: async () => ({ goalId: 'g', done: Promise.resolve() }), routes: [settingsRoutes()],
  });
  stop = s.close;
  const call = (method: string, path: string, body?: unknown) => fetch(`http://127.0.0.1:${s.port}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  return { db, call };
}

describe('rota de limites (GET/PUT /settings/budgets)', () => {
  it('GET sem linha gravada devolve os defaults do CONFIG', async () => {
    const { call } = await mk();
    const r = await call('GET', '/settings/budgets');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ goal: CONFIG.worker.stepBudget, mission: CONFIG.mission.subtaskStepBudget });
  });
  it('PUT grava número e null; GET reflete depois', async () => {
    const { call } = await mk();
    const r = await call('PUT', '/settings/budgets', { goal: 45, mission: null });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ goal: 45, mission: null });
    expect(await (await call('GET', '/settings/budgets')).json()).toEqual({ goal: 45, mission: null });
  });
  it('PUT parcial só troca a chave presente', async () => {
    const { call } = await mk();
    await call('PUT', '/settings/budgets', { goal: 45, mission: 90 });
    const r = await call('PUT', '/settings/budgets', { goal: 100 });
    expect(await r.json()).toEqual({ goal: 100, mission: 90 });
  });
  it('400: fora de 1..1000, não inteiro ou campo desconhecido', async () => {
    const { call } = await mk();
    expect((await call('PUT', '/settings/budgets', { goal: 0 })).status).toBe(400);
    expect((await call('PUT', '/settings/budgets', { goal: 1001 })).status).toBe(400);
    expect((await call('PUT', '/settings/budgets', { goal: 1.5 })).status).toBe(400);
    expect((await call('PUT', '/settings/budgets', { extra: 1 })).status).toBe(400);
  });
  it('PUT ok dispara broadcast do snapshot com os limites novos', async () => {
    const db = openDb(':memory:');
    const s = await startServer({
      db, port: 0, token: 'seg', onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); },
      onGoal: async () => ({ goalId: 'g', done: Promise.resolve() }), routes: [settingsRoutes()],
    });
    stop = s.close;
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws?token=seg`); const msgs: string[] = [];
    await new Promise<void>((r) => { ws.on('message', (m) => { msgs.push(String(m)); if (msgs.length === 1) r(); }); });
    await fetch(`http://127.0.0.1:${s.port}/settings/budgets`, { method: 'PUT', headers: h, body: JSON.stringify({ goal: 12 }) });
    await new Promise((r) => setTimeout(r, 80));
    expect(msgs.length).toBe(2);
    expect((JSON.parse(msgs[1]).data as { stepBudgets: { goal: number } }).stepBudgets.goal).toBe(12);
    ws.close();
  });
});

describe('rota do Guia (PUT /settings/guide)', () => {
  it('grava a configuração concluída e avisa pelo snapshot', async () => {
    const { db, call } = await mk();
    const r = await call('PUT', '/settings/guide', { completed: true });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ completed: true });
    expect(readGuideCompleted(db)).toBe(true);
  });
  it('recusa corpo fora do formato', async () => {
    const { call } = await mk();
    expect((await call('PUT', '/settings/guide', { completed: 'sim' })).status).toBe(400);
    expect((await call('PUT', '/settings/guide', { completed: true, extra: 1 })).status).toBe(400);
  });
});
