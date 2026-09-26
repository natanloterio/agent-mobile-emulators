import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import type { GoalPlan } from '../src/leader/types.js';
import { startServer, type GoalStart } from '../src/server/api.js';
import { goalsRoutes } from '../src/server/routes-goals.js';

let stop: (() => Promise<void>) | null = null;
afterEach(async () => { await stop?.(); stop = null; });

const h = { authorization: 'Bearer seg', 'content-type': 'application/json' };
const PLAN: GoalPlan = {
  text: 'Responder comentários', pattern: 'fan-out', rationale: 'cada conta, sua caixa',
  tasks: [{ identityId: 'conta1', name: 'conta1', handle: '@a', instruction: 'Responder comentários', signals: null, ready: true, readyLabel: 'pronto' }],
  estimate: { tasks: 1, outOfProbe: 0, stepBudget: 30, fleetReadyMs: 8000 }, leader: { model: 'claude-sonnet-5', costUsd: 0.01, error: null },
};

async function mk(o: { onGoal?: (text: string, plan: GoalPlan | null) => Promise<GoalStart>; plan?: (text: string, lang?: string) => Promise<GoalPlan> } = {}) {
  const calls: { text: string; plan: GoalPlan | null }[] = [];
  const planned: string[] = [];
  const s = await startServer({
    db: openDb(':memory:'), port: 0, token: 'seg', onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); },
    onGoal: o.onGoal ?? (async (text, plan) => { calls.push({ text, plan }); return { goalId: 'goal-1', done: Promise.resolve() }; }),
    routes: [goalsRoutes({ plan: o.plan ?? (async (t) => { planned.push(t); return { ...PLAN, text: t }; }) })],
  });
  stop = s.close;
  const post = (path: string, body: unknown) => fetch(`http://127.0.0.1:${s.port}${path}`, { method: 'POST', headers: h, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { s, calls, planned, post };
}

describe('POST /goals/plan', () => {
  it('corpo inválido → 400; válido → GoalPlan do líder', async () => {
    const { post, planned } = await mk();
    expect((await post('/goals/plan', {})).status).toBe(400);
    expect((await post('/goals/plan', { text: 'ab' })).status).toBe(400);
    expect((await post('/goals/plan', 'não é json')).status).toBe(400);
    const r = await post('/goals/plan', { text: 'Responder comentários' });
    expect(r.status).toBe(200); expect(await r.json()).toEqual(PLAN);
    expect(planned).toEqual(['Responder comentários']);
  });
  it('lang opcional: um dos 6 idiomas vai ao líder; outro valor → 400', async () => {
    const langs: (string | undefined)[] = [];
    const { post } = await mk({ plan: async (t, lang) => { langs.push(lang); return { ...PLAN, text: t }; } });
    expect((await post('/goals/plan', { text: 'Reply to comments', lang: 'en' })).status).toBe(200);
    expect((await post('/goals/plan', { text: 'Responder comentários' })).status).toBe(200);
    expect((await post('/goals/plan', { text: 'Responder comentários', lang: 'ja' })).status).toBe(400);
    expect((await post('/goals/plan', { text: 'Responder comentários', lang: 7 })).status).toBe(400);
    expect(langs).toEqual(['en', undefined]);
  });
  it('409 com objetivo em execução', async () => {
    let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
    const { post } = await mk({ onGoal: async () => ({ goalId: 'g', done: gate }) });
    expect((await post('/goals', { text: 'objetivo um' })).status).toBe(202);
    expect((await post('/goals/plan', { text: 'outro objetivo' })).status).toBe(409);
    release(); await new Promise((r) => setTimeout(r, 10));
    expect((await post('/goals/plan', { text: 'outro objetivo' })).status).toBe(200);
  });
  it('erro do planejamento → 500 JSON', async () => {
    const { post } = await mk({ plan: async () => { throw new Error('banco fechado'); } });
    const r = await post('/goals/plan', { text: 'Responder comentários' });
    expect(r.status).toBe(500); expect(await r.json()).toEqual({ error: 'banco fechado' });
  });
});

describe('POST /goals (incremento 5)', () => {
  it('202 com goalId; sem plano → onGoal recebe null', async () => {
    const { post, calls } = await mk();
    const r = await post('/goals', { text: 'Responder comentários' });
    expect(r.status).toBe(202); expect(await r.json()).toEqual({ goalId: 'goal-1' });
    expect(calls).toEqual([{ text: 'Responder comentários', plan: null }]);
  });
  it('plano no corpo é validado e repassado; plano inválido → 400', async () => {
    const { post, calls } = await mk();
    expect((await post('/goals', { text: 'Responder comentários', plan: { ...PLAN, pattern: 'broadcast' } })).status).toBe(400);
    expect((await post('/goals', { text: 'Responder comentários', plan: { ...PLAN, tasks: [{ identityId: 'conta1' }] } })).status).toBe(400);
    expect(calls).toHaveLength(0);
    expect((await post('/goals', { text: 'Responder comentários', plan: PLAN })).status).toBe(202);
    expect(calls[0].plan).toEqual(PLAN);
  });
  it('kill switch recusa novo objetivo (409) até o /resume', async () => {
    const { post, calls } = await mk();
    await post('/kill', {});
    const r = await post('/goals', { text: 'Responder comentários' });
    expect(r.status).toBe(409); expect(((await r.json()) as { error: string }).error).toMatch(/kill switch/);
    await post('/resume', {});
    expect((await post('/goals', { text: 'Responder comentários' })).status).toBe(202);
    expect(calls).toHaveLength(1);
  });
  it('onGoal que lança → 500 e libera o próximo objetivo', async () => {
    let n = 0;
    const { post } = await mk({ onGoal: async () => { if (n++ === 0) throw new Error('sem identidades'); return { goalId: 'g2', done: Promise.resolve() }; } });
    const r = await post('/goals', { text: 'Responder comentários' });
    expect(r.status).toBe(500); expect(await r.json()).toEqual({ error: 'sem identidades' });
    expect((await post('/goals', { text: 'Responder comentários' })).status).toBe(202);
  });
});
