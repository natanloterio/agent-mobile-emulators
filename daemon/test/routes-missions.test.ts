import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { upsertIdentity } from '../src/db/identities.js';
import { addSubtask, createMission, memoryPut, setMissionState, setSubtaskReport } from '../src/db/missions.js';
import { addNote, listNotes, markNotesRead } from '../src/db/mission-notes.js';
import { MissionError, type MissionRunner } from '../src/mission/runner.js';
import { startServer } from '../src/server/api.js';
import { missionRoutes } from '../src/server/routes-missions.js';
import { missionViews } from '../src/server/snapshot-missions.js';
import { buildSnapshot } from '../src/server/snapshot.js';

let stop: (() => Promise<void>) | null = null;
afterEach(async () => { await stop?.(); stop = null; });
const h = { authorization: 'Bearer seg', 'content-type': 'application/json' };
const row = { id: 'conta2', name: 'conta2', handle: 'sem conta', avdName: 'x', serial: 's', consolePort: 5556, mcpHostPort: 8081, mcpToken: 't', deviceSlug: 'conta2', appPackage: 'com.instagram.android', appVersionName: '1', state: 'idle' as const };
const identityMask = async () => (s: string) => s;

async function mk(overrides: Partial<MissionRunner> = {}, mask: (missionId: string) => Promise<(s: string) => string> = identityMask) {
  const calls: string[] = [];
  const runner: MissionRunner = {
    start: (identityId, text, lang) => { calls.push(`start ${identityId} ${text} ${lang}`); if (identityId === 'ocupada') throw new MissionError('identidade já tem uma missão aberta', 409); return 'm-1'; },
    pause: (id) => { calls.push(`pause ${id}`); if (id === 'nada') throw new MissionError('missão desconhecida', 404); return 'paused'; },
    resume: (id) => { calls.push(`resume ${id}`); return 'running'; },
    continue: (id) => { calls.push(`continue ${id}`); if (id === 'm-1') throw new MissionError('a missão não está esperando humano', 409); return 'running'; },
    abandon: (id) => { calls.push(`abandon ${id}`); return 'abandoned'; },
    resumeAllOnStart: () => 0, settle: async () => undefined,
    ...overrides,
  };
  const db = openDb(':memory:'); upsertIdentity(db, row);
  const s = await startServer({ db, port: 0, token: 'seg', onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); }, onGoal: async () => ({ goalId: 'g', done: Promise.resolve() }), routes: [missionRoutes({ runner, mask })] });
  stop = s.close;
  const post = (path: string, body?: unknown) => fetch(`http://127.0.0.1:${s.port}${path}`, { method: 'POST', headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  return { calls, post, db };
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
  it('POST /missions/:id/instruct: 400 texto inválido; 404 missão desconhecida; 409 missão encerrada; 200 grava a nota mascarada', async () => {
    const t = await mk();
    const running = createMission(t.db, 'conta2', 'missão', 'pt');
    expect((await t.post(`/missions/${running}/instruct`, { text: '' })).status).toBe(400);
    expect((await t.post(`/missions/${running}/instruct`, { text: '  ' })).status).toBe(400);
    expect((await t.post(`/missions/${running}/instruct`, { text: 'x'.repeat(1001) })).status).toBe(400);
    expect((await t.post('/missions/nada/instruct', { text: 'oi' })).status).toBe(404);
    const done = createMission(t.db, 'conta2', 'outra', 'pt'); setMissionState(t.db, done, 'done');
    expect((await t.post(`/missions/${done}/instruct`, { text: 'oi' })).status).toBe(409);
    const r = await t.post(`/missions/${running}/instruct`, { text: '  use o YopMail pelo Chrome  ' });
    expect(r.status).toBe(200);
    const body = await r.json() as { noteId: number; missionState: string };
    expect(body.missionState).toBe('running');
    expect(typeof body.noteId).toBe('number');
    expect(listNotes(t.db, running)).toEqual([{ id: body.noteId, text: 'use o YopMail pelo Chrome', createdAt: expect.any(String), readAt: null, readSeq: null }]);
  });
  it('POST /missions/:id/instruct: texto passa pela máscara de segredos antes de gravar', async () => {
    const t = await mk({}, async () => (s: string) => s.split('Xy7!segredo').join('•••'));
    const m = createMission(t.db, 'conta2', 'missão', 'pt');
    await t.post(`/missions/${m}/instruct`, { text: 'a senha é Xy7!segredo' });
    expect(listNotes(t.db, m)[0].text).toBe('a senha é •••');
  });
  it('POST /missions/:id/instruct: then=continue chama runner.continue e devolve o estado dele; then=resume chama runner.resume', async () => {
    const t = await mk();
    const awaiting = createMission(t.db, 'conta2', 'missão', 'pt'); setMissionState(t.db, awaiting, 'awaiting-human', 'captcha');
    const r = await t.post(`/missions/${awaiting}/instruct`, { text: 'toque em reenviar', then: 'continue' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ noteId: expect.any(Number), missionState: 'running' });
    expect(t.calls).toContain(`continue ${awaiting}`);
    const paused = createMission(t.db, 'conta2', 'missão b', 'pt'); setMissionState(t.db, paused, 'paused', 'pausada pelo usuário');
    await t.post(`/missions/${paused}/instruct`, { text: 'segue', then: 'resume' });
    expect(t.calls).toContain(`resume ${paused}`);
  });
  it('POST /missions/:id/instruct: erro 409 do runner (then) propaga, mas a nota já foi gravada', async () => {
    const t = await mk({ continue: () => { throw new MissionError('a missão não está esperando humano', 409); } });
    const m = createMission(t.db, 'conta2', 'missão', 'pt');
    const r = await t.post(`/missions/${m}/instruct`, { text: 'nunca vai continuar', then: 'continue' });
    expect(r.status).toBe(409);
    expect(listNotes(t.db, m)).toHaveLength(1);
  });
});

describe('missões no snapshot', () => {
  it('subtarefas, atual, memória sem valor de segredo, notas mais recentes primeiro', () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const m = createMission(db, 'conta2', 'missão', 'pt');
    const t1 = addSubtask(db, m, 'e-mail', 'caixa'); setSubtaskReport(db, t1, { ok: true, did: 'Outlook', blockers: '' });
    db.prepare("update task set state='done' where id=?").run(t1);
    addSubtask(db, m, 'Instagram', 'conta');
    memoryPut(db, m, 'email.address', 'x@y.z'); memoryPut(db, m, 'email.password', 'mission:m:email.password', true);
    const n1 = addNote(db, m, 'primeira'); markNotesRead(db, [n1], 1); addNote(db, m, 'segunda');
    const [v] = missionViews(db);
    expect(v).toMatchObject({ id: m, identityId: 'conta2', state: 'running', current: { seq: 2, objective: 'Instagram' } });
    expect(v.notes.map((n) => [n.text, n.readSeq])).toEqual([['segunda', null], ['primeira', 1]]);
    expect(v.subtasks.map((s) => [s.seq, s.state])).toEqual([[1, 'done'], [2, 'running']]);
    expect(v.memory).toEqual([{ key: 'email.address', value: 'x@y.z', secret: false }, { key: 'email.password', value: null, secret: true }]);
    expect(buildSnapshot(db, false).missions).toHaveLength(1);
  });
});
