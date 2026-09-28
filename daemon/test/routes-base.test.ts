import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { IDLE_PREP, writeBasePrep } from '../src/db/base-settings.js';
import { startServer } from '../src/server/api.js';
import { baseRoutes } from '../src/server/routes-base.js';

let stop: (() => Promise<void>) | null = null;
afterEach(async () => { await stop?.(); stop = null; });
const h = { authorization: 'Bearer seg', 'content-type': 'application/json' };

async function mk() {
  const db = openDb(':memory:');
  const calls: string[] = [];
  const s = await startServer({
    db, port: 0, token: 'seg', onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); },
    onGoal: async () => ({ goalId: 'g', done: Promise.resolve() }),
    routes: [baseRoutes({
      prepare: (lang) => { calls.push(`prepare ${lang}`); },
      saveGoogle: async (email, password) => { calls.push(`google ${email} ${password.length}`); },
      continueMission: (id) => { calls.push(`continue ${id}`); },
      reset: () => { calls.push('reset'); },
    })],
  });
  stop = s.close;
  const call = (method: string, p: string, body?: unknown) => fetch(`http://127.0.0.1:${s.port}${p}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  return { db, call, calls };
}

describe('rotas do celular-base', () => {
  it('POST /base/prepare começa com o idioma da tela e responde na hora', async () => {
    const { call, calls } = await mk();
    expect((await call('POST', '/base/prepare', { lang: 'en' })).status).toBe(202);
    expect(calls).toEqual(['prepare en']);
  });
  it('PUT /base/google valida sem repetir a senha e retoma quem esperava a conta', async () => {
    const { db, call, calls } = await mk();
    const bad = await call('PUT', '/base/google', { email: 'nada', password: 'segredo123' });
    expect(bad.status).toBe(400);
    expect(await bad.text()).not.toContain('segredo123');
    writeBasePrep(db, { ...IDLE_PREP, state: 'needs-google', phase: 'google' });
    expect((await call('PUT', '/base/google', { email: 'eu@gmail.com', password: 'segredo123' })).status).toBe(204);
    expect(calls).toEqual(['google eu@gmail.com 10', 'prepare pt']);
  });
  it('POST /base/continue só quando o preparo espera verificação humana', async () => {
    const { db, call, calls } = await mk();
    expect((await call('POST', '/base/continue')).status).toBe(409);
    writeBasePrep(db, { ...IDLE_PREP, state: 'needs-human', phase: 'app', missionId: 'm1' });
    expect((await call('POST', '/base/continue')).status).toBe(200);
    expect(calls).toEqual(['continue m1']);
  });
  it('continue também vale depois de um reinício (preparo virou failed com a missão aberta); reset começa de novo', async () => {
    const { db, call, calls } = await mk();
    writeBasePrep(db, { ...IDLE_PREP, state: 'failed', phase: 'app', missionId: 'm2' });
    expect((await call('POST', '/base/continue')).status).toBe(200);
    expect((await call('POST', '/base/reset')).status).toBe(200);
    expect(calls).toEqual(['continue m2', 'reset']);
  });
});
