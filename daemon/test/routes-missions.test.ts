import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { upsertIdentity } from '../src/db/identities.js';
import { addSubtask, createMission, memoryPut, setSubtaskReport } from '../src/db/missions.js';
import { MissionError, type MissionRunner } from '../src/mission/runner.js';
import { startServer } from '../src/server/api.js';
import { missionRoutes } from '../src/server/routes-missions.js';
import { missionViews } from '../src/server/snapshot-missions.js';
import { buildSnapshot } from '../src/server/snapshot.js';

let stop: (() => Promise<void>) | null = null;
afterEach(async () => { await stop?.(); stop = null; });
const h = { authorization: 'Bearer seg', 'content-type': 'application/json' };
const row = { id: 'conta2', name: 'conta2', handle: 'sem conta', avdName: 'x', serial: 's', consolePort: 5556, mcpHostPort: 8081, mcpToken: 't', deviceSlug: 'conta2', appPackage: 'com.instagram.android', appVersionName: '1', state: 'idle' as const };

async function mk() {
  const calls: string[] = [];
  const runner: MissionRunner = {
    start: (identityId, text, lang) => { calls.push(`start ${identityId} ${text} ${lang}`); if (identityId === 'ocupada') throw new MissionError('identidade já tem uma missão aberta', 409); return 'm-1'; },
    pause: (id) => { calls.push(`pause ${id}`); if (id === 'nada') throw new MissionError('missão desconhecida', 404); return 'paused'; },
    resume: (id) => { calls.push(`resume ${id}`); return 'running'; },
    continue: (id) => { calls.push(`continue ${id}`); throw new MissionError('a missão não está esperando humano', 409); },
    abandon: (id) => { calls.push(`abandon ${id}`); return 'abandoned'; },
    resumeAllOnStart: () => 0, settle: async () => undefined,
  };
  const s = await startServer({ db: openDb(':memory:'), port: 0, token: 'seg', onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); }, onGoal: async () => ({ goalId: 'g', done: Promise.resolve() }), routes: [missionRoutes({ runner })] });
  stop = s.close;
  const post = (path: string, body?: unknown) => fetch(`http://127.0.0.1:${s.port}${path}`, { method: 'POST', headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  return { calls, post };
}

describe('rotas de missão', () => {
  it('POST /missions: 201 com goalId; 400 corpo inválido; 409 do runner', async () => {
    const t = await mk();
    const r = await t.post('/missions', { identityId: 'conta2', text: 'crie um e-mail', lang: 'en' });
    expect(r.status).toBe(201); expect(await r.json()).toEqual({ goalId: 'm-1' });
    expect((await t.post('/missions', { identityId: 'conta2', text: 'ab' })).status).toBe(400);
    expect((await t.post('/missions', { identityId: '../x', text: 'crie um e-mail' })).status).toBe(400);
    expect((await t.post('/missions', { identityId: 'conta2', text: 'crie um e-mail', lang: 'ja' })).status).toBe(400);
    expect((await t.post('/missions', { identityId: 'ocupada', text: 'crie um e-mail' })).status).toBe(409);
    expect(t.calls).toEqual(['start conta2 crie um e-mail en', 'start ocupada crie um e-mail pt']);
  });
  it('ações: 200 com estado; erros do runner viram 404/409', async () => {
    const t = await mk();
    const r = await t.post('/missions/m-1/pause');
    expect(r.status).toBe(200); expect(await r.json()).toEqual({ missionState: 'paused' });
    expect((await t.post('/missions/nada/pause')).status).toBe(404);
    expect((await t.post('/missions/m-1/continue')).status).toBe(409);
    expect((await t.post('/missions/m-1/voar')).status).toBe(404);
  });
});

describe('missões no snapshot', () => {
  it('subtarefas, atual, memória sem valor de segredo', () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const m = createMission(db, 'conta2', 'missão', 'pt');
    const t1 = addSubtask(db, m, 'e-mail', 'caixa'); setSubtaskReport(db, t1, { ok: true, did: 'Outlook', blockers: '' });
    db.prepare("update task set state='done' where id=?").run(t1);
    addSubtask(db, m, 'Instagram', 'conta');
    memoryPut(db, m, 'email.address', 'x@y.z'); memoryPut(db, m, 'email.password', 'mission:m:email.password', true);
    const [v] = missionViews(db);
    expect(v).toMatchObject({ id: m, identityId: 'conta2', state: 'running', current: { seq: 2, objective: 'Instagram' } });
    expect(v.subtasks.map((s) => [s.seq, s.state])).toEqual([[1, 'done'], [2, 'running']]);
    expect(v.memory).toEqual([{ key: 'email.address', value: 'x@y.z', secret: false }, { key: 'email.password', value: null, secret: true }]);
    expect(buildSnapshot(db, false).missions).toHaveLength(1);
  });
});
