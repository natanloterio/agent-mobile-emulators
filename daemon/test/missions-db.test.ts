import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { upsertIdentity } from '../src/db/identities.js';
import { setTaskState } from '../src/db/tasks.js';
import {
  addMissionCost, addSubtask, createMission, getMission, listMemory, listMissions, listSubtasks, markInterrupted,
  memoryGet, memoryPut, openMissionFor, recalcStalled, setMissionState, setSubtaskReport,
} from '../src/db/missions.js';

const row = { id: 'conta2', name: 'conta2', handle: 'sem conta', avdName: 'x', serial: 's', consolePort: 5556, mcpHostPort: 8081, mcpToken: 't', deviceSlug: 'conta2', appPackage: 'com.instagram.android', appVersionName: '1', state: 'idle' as const };
const fresh = () => { const db = openDb(':memory:'); upsertIdentity(db, row); return db; };

describe('missões no banco', () => {
  it('cria missão como goal pattern=mission, running, aberta para a identidade', () => {
    const db = fresh();
    const id = createMission(db, 'conta2', 'crie um e-mail', 'pt');
    expect(getMission(db, id)).toMatchObject({ identityId: 'conta2', text: 'crie um e-mail', state: 'running', stalled: false, lang: 'pt', humanReason: null });
    expect((db.prepare('select pattern, state from goal where id=?').get(id) as { pattern: string; state: string })).toEqual({ pattern: 'mission', state: 'running' });
    expect(openMissionFor(db, 'conta2')?.id).toBe(id);
  });
  it('done/abandoned fecham o goal (done/failed) e liberam a identidade; awaiting-human guarda o motivo', () => {
    const db = fresh();
    const a = createMission(db, 'conta2', 'missão a', 'pt');
    setMissionState(db, a, 'awaiting-human', 'captcha no cadastro');
    expect(getMission(db, a)).toMatchObject({ state: 'awaiting-human', humanReason: 'captcha no cadastro' });
    setMissionState(db, a, 'running');
    expect(getMission(db, a)?.humanReason).toBeNull();
    setMissionState(db, a, 'abandoned');
    expect(db.prepare('select state, finished_at from goal where id=?').get(a)).toMatchObject({ state: 'failed' });
    expect(getMission(db, a)?.finishedAt).toBeTruthy();
    expect(openMissionFor(db, 'conta2')).toBeNull();
    const b = createMission(db, 'conta2', 'missão b', 'pt'); setMissionState(db, b, 'done');
    expect((db.prepare('select state from goal where id=?').get(b) as { state: string }).state).toBe('done');
    expect(listMissions(db).map((m) => m.id)).toEqual([b, a]);
  });
  it('subtarefas numeradas em sequência, com relatório e custo somado na missão', () => {
    const db = fresh();
    const m = createMission(db, 'conta2', 'missão', 'pt');
    const t1 = addSubtask(db, m, 'conseguir e-mail', 'caixa aberta');
    const t2 = addSubtask(db, m, 'cadastrar no Instagram', 'conta criada');
    setSubtaskReport(db, t1, { ok: true, did: 'criou no Outlook', blockers: '' });
    setTaskState(db, t1, 'done');
    addMissionCost(db, m, 0.25);
    const subs = listSubtasks(db, m);
    expect(subs.map((s) => [s.seq, s.objective, s.successCriteria, s.state])).toEqual([[1, 'conseguir e-mail', 'caixa aberta', 'done'], [2, 'cadastrar no Instagram', 'conta criada', 'running']]);
    expect(subs[0].report).toEqual({ ok: true, did: 'criou no Outlook', blockers: '' });
    expect(getMission(db, m)?.costUsd).toBeCloseTo(0.25);
    expect(t2).toBeTruthy();
  });
  it('markInterrupted só mexe em subtarefas running de missões', () => {
    const db = fresh();
    const m = createMission(db, 'conta2', 'missão', 'pt'); const t = addSubtask(db, m, 'x', 'y');
    expect(markInterrupted(db)).toBe(1);
    expect(listSubtasks(db, m)[0].state).toBe('interrupted');
    expect(t).toBeTruthy();
  });
  it('stalled com as 3 últimas failed; um sucesso limpa', () => {
    const db = fresh(); const m = createMission(db, 'conta2', 'missão', 'pt');
    for (let i = 0; i < 3; i++) setTaskState(db, addSubtask(db, m, `t${i}`, 'c'), 'failed');
    expect(recalcStalled(db, m)).toBe(true); expect(getMission(db, m)?.stalled).toBe(true);
    setTaskState(db, addSubtask(db, m, 'ok', 'c'), 'done');
    expect(recalcStalled(db, m)).toBe(false); expect(getMission(db, m)?.stalled).toBe(false);
  });
  it('memória: upsert por chave; segredo marcado', () => {
    const db = fresh(); const m = createMission(db, 'conta2', 'missão', 'pt');
    memoryPut(db, m, 'email.address', 'a@b.c');
    memoryPut(db, m, 'email.address', 'x@y.z');
    memoryPut(db, m, 'email.password', 'mission:m:email.password', true);
    expect(listMemory(db, m)).toEqual([{ key: 'email.address', value: 'x@y.z', secret: false }, { key: 'email.password', value: 'mission:m:email.password', secret: true }]);
    expect(memoryGet(db, m, 'nada')).toBeNull();
  });
});
