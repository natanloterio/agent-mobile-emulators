import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { getIdentity, setIdentityFlags, setIdentityState, upsertIdentity } from '../src/db/identities.js';
import { createMission, getMission, listSubtasks, setMissionState, setSubtaskReport } from '../src/db/missions.js';
import { setTaskState } from '../src/db/tasks.js';
import { runMission, type MissionDeps, type SubtaskJob } from '../src/mission/loop.js';
import type { PlannerDecision, PlannerInput } from '../src/mission/planner.js';
import { parseScreen } from '../src/screen/parse.js';
import { createSecretMask } from '../src/worker/mission-tools.js';

const row = { id: 'conta2', name: 'conta2', handle: 'sem conta', avdName: 'x', serial: 's', consolePort: 5556, mcpHostPort: 8081, mcpToken: 't', deviceSlug: 'conta2', appPackage: 'com.instagram.android', appVersionName: '1', state: 'idle' as const };
const SCREEN = parseScreen('screen:1080x2400 density:420 orientation:portrait\n--- window:1 type:APPLICATION pkg:com.android.chrome title:x layer:0 focused:true ---\nnode_id\tclass\ttext\tdesc\tres_id\tbounds\tflags\nnode_1\tTextView\tCriar conta\t-\t-\t0,0,10,10\ton,ena\n');
type Db = ReturnType<typeof openDb>;
type Step = 'done' | 'failed' | 'needs-human' | 'interrupted';

function harness(decisions: readonly PlannerDecision[], steps: readonly Step[] = [], o: { killed?: () => boolean; planThrows?: boolean; onRun?: (db: Db, j: SubtaskJob) => void } = {}) {
  const db = openDb(':memory:'); upsertIdentity(db, row);
  const id = createMission(db, 'conta2', 'crie e-mail e Instagram', 'pt');
  const inputs: PlannerInput[] = []; const jobs: SubtaskJob[] = []; const promoted: string[] = [];
  let p = 0; let s = 0;
  const deps: MissionDeps = {
    db, isKilled: o.killed ?? (() => false),
    plan: async (i) => { inputs.push(i); if (o.planThrows) throw new Error('modelo fora do ar'); return { decision: decisions[p++], costUsd: 0.01 }; },
    runSubtask: async (j) => {
      jobs.push(j); o.onRun?.(db, j);
      const st = steps[s++] ?? 'done';
      if (st === 'done' || st === 'failed') setSubtaskReport(db, j.taskId, { ok: st === 'done', did: `fez ${j.taskId.slice(0, 4)}`, blockers: st === 'failed' ? 'deu errado' : '' });
      setTaskState(db, j.taskId, st);
      return { humanReason: st === 'needs-human' ? 'captcha no cadastro' : null, summary: st === 'interrupted' ? 'MCP caiu' : '' };
    },
    readScreen: async () => SCREEN,
    mask: async () => (t: string) => t,
    promote: async (m) => { promoted.push(m); },
  };
  return { db, id, deps, inputs, jobs, promoted };
}
const next = (objective: string): PlannerDecision => ({ kind: 'next', objective, successCriteria: `${objective} ok`, rationale: 'r' });

describe('runMission', () => {
  it('next → next → done: duas subtarefas, promoção, identidade idle, custo do planejador somado', async () => {
    const h = harness([next('criar e-mail'), next('cadastrar Instagram'), { kind: 'done', summary: 'feito' }]);
    expect(await runMission(h.id, h.deps)).toBe('done');
    expect(listSubtasks(h.db, h.id).map((t) => [t.seq, t.objective, t.state])).toEqual([[1, 'criar e-mail', 'done'], [2, 'cadastrar Instagram', 'done']]);
    expect(h.promoted).toEqual([h.id]);
    expect(getIdentity(h.db, 'conta2')?.state).toBe('idle');
    expect(getMission(h.db, h.id)?.costUsd).toBeCloseTo(0.03);
    expect(h.jobs[1].instruction).toContain('Subtarefa: cadastrar Instagram');
    expect(h.inputs[1].subtasks[0].report?.ok).toBe(true);
    expect(h.inputs[0].screen).toContain('app: com.android.chrome');
  });
  it('falha → planejador vê o relatório e replaneja; 3 falhas seguidas marcam stalled sem parar', async () => {
    const h = harness([next('gmail'), next('outlook'), next('proton'), { kind: 'done', summary: 'x' }], ['failed', 'failed', 'failed']);
    expect(await runMission(h.id, h.deps)).toBe('done');
    expect(h.inputs[1].subtasks[0]).toMatchObject({ state: 'failed', report: { blockers: 'deu errado' } });
    expect(h.inputs[3].subtasks).toHaveLength(3);
  });
  it('subtarefa needs-human → awaiting-human com motivo; identidade needs-human', async () => {
    const h = harness([next('cadastrar')], ['needs-human']);
    expect(await runMission(h.id, h.deps)).toBe('awaiting-human');
    expect(getMission(h.db, h.id)).toMatchObject({ state: 'awaiting-human', humanReason: 'captcha no cadastro' });
    expect(getIdentity(h.db, 'conta2')).toMatchObject({ state: 'needs-human', lastError: 'captcha no cadastro' });
  });
  it('planejador decide human → awaiting-human sem criar subtarefa', async () => {
    const h = harness([{ kind: 'human', reason: 'todos pedem telefone' }]);
    expect(await runMission(h.id, h.deps)).toBe('awaiting-human');
    expect(listSubtasks(h.db, h.id)).toEqual([]);
  });
  it('planejador falha → paused com o erro, sem subtarefa', async () => {
    const h = harness([], [], { planThrows: true });
    expect(await runMission(h.id, h.deps)).toBe('paused');
    expect(getMission(h.db, h.id)?.humanReason).toMatch(/planejador: modelo fora do ar/);
    expect(listSubtasks(h.db, h.id)).toEqual([]);
  });
  it('infra no meio da subtarefa → interrupted e missão paused com o motivo', async () => {
    const h = harness([next('cadastrar')], ['interrupted']);
    expect(await runMission(h.id, h.deps)).toBe('paused');
    expect(getMission(h.db, h.id)?.humanReason).toMatch(/infra: MCP caiu/);
    expect(getIdentity(h.db, 'conta2')?.state).toBe('idle');
  });
  it('kill switch → paused "kill switch" antes de planejar', async () => {
    const h = harness([next('x')], [], { killed: () => true });
    expect(await runMission(h.id, h.deps)).toBe('paused');
    expect(getMission(h.db, h.id)?.humanReason).toBe('kill switch');
    expect(h.inputs).toHaveLength(0);
  });
  it('controle humano ligado no meio → subtarefa interrupted, missão paused "controle humano"', async () => {
    const h = harness([next('x')], ['interrupted'], { onRun: (db) => setIdentityFlags(db, 'conta2', { controlled: true }) });
    expect(await runMission(h.id, h.deps)).toBe('paused');
    expect(getMission(h.db, h.id)?.humanReason).toBe('controle humano');
  });
  it('usuário pausou durante a subtarefa → loop sai sem sobrescrever o motivo; shouldStop vira true', async () => {
    let stopSeen = false;
    const h = harness([next('x')], ['interrupted'], { onRun: (db, j) => { setMissionState(db, j.missionId, 'paused', 'pausada pelo usuário'); stopSeen = j.shouldStop(); } });
    expect(await runMission(h.id, h.deps)).toBe('paused');
    expect(stopSeen).toBe(true);
    expect(getMission(h.db, h.id)?.humanReason).toBe('pausada pelo usuário');
  });
  it('device não responde na leitura de tela → paused "device indisponível"', async () => {
    const h = harness([next('x')]);
    const r = await runMission(h.id, { ...h.deps, readScreen: async () => { throw new Error('MCP 8081 recusou'); } });
    expect(r).toBe('paused');
    expect(getMission(h.db, h.id)?.humanReason).toMatch(/device indisponível: MCP 8081 recusou/);
  });
  it('identidade já em needs-human (outro subsistema) → paused sem apagar motivo; planejador nunca chamado', async () => {
    const h = harness([next('x')]);
    setIdentityState(h.db, 'conta2', 'needs-human', { lastError: 'restauração falhou' });
    const r = await runMission(h.id, h.deps);
    expect(r).toBe('paused');
    expect(getMission(h.db, h.id)?.humanReason).toContain('restauração falhou');
    expect(getIdentity(h.db, 'conta2')).toMatchObject({ state: 'needs-human', lastError: 'restauração falhou' });
    expect(h.inputs).toHaveLength(0);
  });
  it('segredo na tela nunca chega ao planejador; eco do planejador é mascarado antes de gravar', async () => {
    const pwd = 'Xy7!senhaForte2026';
    const screenWithPwd = parseScreen(`screen:1080x2400 density:420 orientation:portrait\n--- window:1 type:APPLICATION pkg:com.android.chrome title:x layer:0 focused:true ---\nnode_id\tclass\ttext\tdesc\tres_id\tbounds\tflags\nnode_1\tEditText\t${pwd}\t-\t-\t0,0,10,10\ton,ena\n`);
    const h = harness([{ kind: 'next', objective: `confirmar a senha ${pwd}`, successCriteria: `campo com ${pwd}`, rationale: pwd }, { kind: 'human', reason: `digite ${pwd}` }]);
    const r = await runMission(h.id, { ...h.deps, readScreen: async () => screenWithPwd, mask: async () => createSecretMask([pwd]).mask });
    expect(r).toBe('awaiting-human');
    expect(h.inputs[0].screen).toContain('•••');
    expect(JSON.stringify(h.inputs)).not.toContain(pwd);
    expect(listSubtasks(h.db, h.id)[0]).toMatchObject({ objective: 'confirmar a senha •••' });
    expect(h.jobs[0].instruction).not.toContain(pwd);
    expect(JSON.stringify(h.db.prepare('select * from task').all())).not.toContain(pwd);
    expect(getMission(h.db, h.id)?.humanReason).toBe('digite •••');
    expect(getIdentity(h.db, 'conta2')?.lastError).toBe('digite •••');
  });
  it('cofre indisponível ao montar a máscara → paused "cofre: …" sem chamar o planejador', async () => {
    const h = harness([next('x')]);
    const r = await runMission(h.id, { ...h.deps, mask: async () => { throw new Error('chaveiro travado'); } });
    expect(r).toBe('paused');
    expect(getMission(h.db, h.id)?.humanReason).toBe('cofre: chaveiro travado');
    expect(h.inputs).toHaveLength(0);
  });
  it('kill switch durante o planejamento → paused sem criar subtarefa', async () => {
    let planned = false;
    const h = harness([next('x')], [], { killed: () => planned });
    const plan = h.deps.plan;
    const r = await runMission(h.id, { ...h.deps, plan: async (i) => { const out = await plan(i); planned = true; return out; } });
    expect(r).toBe('paused');
    expect(getMission(h.db, h.id)?.humanReason).toBe('kill switch');
    expect(listSubtasks(h.db, h.id)).toEqual([]);
    expect(h.jobs).toHaveLength(0);
  });
});
