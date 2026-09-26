import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { openDb } from '../src/db/open.js';
import { getIdentity, setIdentityFlags, setIdentityState, upsertIdentity, type IdentityRow } from '../src/db/identities.js';
import type { ProbeResult } from '../src/device/probe.js';
import { deterministicPlan, planGoal } from '../src/leader/plan.js';
import { GoalPlanSchema } from '../src/leader/types.js';

const base = { avdName: 'x', consolePort: 5554, mcpHostPort: 8080, mcpToken: 't', appPackage: 'com.instagram.android', appVersionName: '1', state: 'idle' as const };
const mk = (n: number) => ({ ...base, id: `conta${n}`, name: `conta${n}`, handle: `@c${n}`, serial: `emulator-${5552 + 2 * n}`, deviceSlug: `conta${n}` });
const OK = { bootCompleted: true, accessibility: true, mcpInitialize: true, toolsPresent: true, versionMatch: true };
const ready: ProbeResult = { ready: true, signals: OK, details: [], failureClass: null };
const versionOff: ProbeResult = { ready: false, signals: { ...OK, versionMatch: false }, details: ['versionName 449 ≠ 1 registrado'], failureClass: 'version' };
const offline: ProbeResult = { ready: false, signals: { ...OK, bootCompleted: false, mcpInitialize: false, toolsPresent: false }, details: ["adb: device 'emulator-5558' not found em lugar nenhum desta máquina"], failureClass: 'infra' };

const usage = { inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 200, text: 200, reasoning: 0 } };
const json = (o: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(o) }], finishReason: { unified: 'stop' as const }, usage, warnings: [] });
const CLOUD = { role: 'lider' as const, mode: 'nuvem' as const, model: 'claude-sonnet-5', endpoint: 'anthropic' };
const PROVIDERS = { lider: CLOUD, worker: { ...CLOUD, role: 'worker' as const }, esc: { ...CLOUD, role: 'esc' as const } };

function fleet(n: number) {
  const db = openDb(':memory:');
  for (let i = 1; i <= n; i++) upsertIdentity(db, mk(i));
  return db;
}
const probeBy = (m: Record<string, ProbeResult>) => {
  const seen: string[] = [];
  return { seen, ensureReady: async (id: IdentityRow) => { seen.push(id.id); return m[id.id] ?? ready; } };
};

describe('planGoal — líder com LLM', () => {
  it('saída estruturada vira plano: padrão, justificativa, instrução por identidade, sonda, estimativa e custo', async () => {
    const db = fleet(3); setIdentityFlags(db, 'conta3', { paused: true });
    const p = probeBy({ conta2: versionOff });
    const model = new MockLanguageModelV4({ doGenerate: [json({ pattern: 'sharding', rationale: 'Fila única de menções: dividir entre as prontas.', instructions: [
      { identityId: 'conta1', instruction: 'trate as menções 1–20' }, { identityId: 'conta2', instruction: 'trate as menções 21–40' }, { identityId: 'fantasma', instruction: 'x' },
    ] })] as never });
    const plan = await planGoal('Responder as 40 menções da fila', { db, ensureReady: p.ensureReady, model, providers: PROVIDERS, stepBudget: 30, staggerMs: 8000 });
    expect(GoalPlanSchema.parse(plan)).toEqual(plan);
    expect(plan).toMatchObject({ text: 'Responder as 40 menções da fila', pattern: 'sharding', rationale: 'Fila única de menções: dividir entre as prontas.' });
    expect(plan.tasks.map((t) => [t.identityId, t.ready, t.readyLabel, t.instruction])).toEqual([
      ['conta1', true, 'pronto', 'trate as menções 1–20'],
      ['conta2', false, 'versão mudou · fora', 'trate as menções 21–40'],
      ['conta3', false, 'pausada', 'Responder as 40 menções da fila'],
    ]);
    expect(p.seen).toEqual(['conta1', 'conta2']); // pausada não é sondada
    expect(plan.tasks[0].signals).toEqual(OK);
    expect(getIdentity(db, 'conta2')?.lastSignals?.versionMatch).toBe(false);
    expect(plan.estimate).toEqual({ tasks: 1, outOfProbe: 2, stepBudget: 30, fleetReadyMs: 8000 });
    expect(plan.leader.model).toBe('claude-sonnet-5'); expect(plan.leader.error).toBeNull();
    expect(plan.leader.costUsd).toBeCloseTo((1000 * 2 + 200 * 10) / 1e6, 8) // líder na nuvem = claude-sonnet-5 (US$ 2/10 por M);
    const prompt = JSON.stringify(model.doGenerateCalls[0].prompt);
    expect(prompt).toMatch(/Responder as 40 menções/); expect(prompt).toMatch(/@c2/);
  });
  it('erro do modelo → regra determinística e erro no plano', async () => {
    const db = fleet(1);
    const model = new MockLanguageModelV4({ doGenerate: async () => { throw new Error('overloaded_error'); } });
    const plan = await planGoal('Responder comentários da minha caixa', { db, ensureReady: probeBy({}).ensureReady, model, providers: PROVIDERS });
    expect(plan.pattern).toBe('fan-out'); expect(plan.leader.error).toMatch(/overloaded_error/);
    expect(plan.leader.costUsd).toBe(0); expect(plan.tasks[0].instruction).toBe('Responder comentários da minha caixa');
  });
  it('papel nuvem sem chave → determinístico com o erro de chave ausente', async () => {
    const db = fleet(1);
    const plan = await planGoal('Responder comentários', { db, ensureReady: probeBy({}).ensureReady, providers: PROVIDERS, apiKey: '' });
    expect(plan.leader.error).toMatch(/ANTHROPIC_API_KEY/); expect(plan.pattern).toBe('fan-out');
  });
  it('papel local: garante o Ollama antes de chamar o modelo', async () => {
    const db = fleet(1); const ensured: string[] = [];
    const local = { ...PROVIDERS, lider: { role: 'lider' as const, mode: 'local' as const, model: 'gpt-oss:20b', endpoint: 'http://127.0.0.1:11434/v1' } };
    const model = new MockLanguageModelV4({ doGenerate: [json({ pattern: 'fan-out', rationale: 'Cada conta tem a própria caixa.', instructions: [] })] as never });
    const plan = await planGoal('Responder comentários', { db, ensureReady: probeBy({}).ensureReady, model, providers: local, ollama: { ensure: async (e, m) => { ensured.push(`${e}|${m}`); } } });
    expect(ensured).toEqual(['http://127.0.0.1:11434/v1|gpt-oss:20b']);
    expect(plan.leader).toMatchObject({ model: 'gpt-oss:20b', costUsd: 0, error: null });
  });
  it('papel local: prosa fora do schema ganha uma nova tentativa antes da regra', async () => {
    const db = fleet(1);
    const local = { ...PROVIDERS, lider: { role: 'lider' as const, mode: 'local' as const, model: 'gpt-oss:20b', endpoint: 'http://127.0.0.1:11434/v1' } };
    const prose = { content: [{ type: 'text', text: '**Padrão de resposta escolhido**' }], finishReason: { unified: 'stop', raw: 'stop' }, usage: json({}).usage, warnings: [] };
    const model = new MockLanguageModelV4({ doGenerate: [prose, json({ pattern: 'sharding', rationale: 'Fila compartilhada.', instructions: [] })] as never });
    const plan = await planGoal('Responder comentários', { db, ensureReady: probeBy({}).ensureReady, model, providers: local, ollama: { ensure: async () => undefined } });
    expect(plan.leader.error).toBeNull(); expect(plan.pattern).toBe('sharding'); expect(model.doGenerateCalls).toHaveLength(2);
  });
});

describe('planGoal — frota', () => {
  it('descartada e banida ficam fora; controlada, needs-human e offline têm rótulo sem sonda indevida', async () => {
    const db = fleet(5);
    setIdentityFlags(db, 'conta1', { discardedAt: '2026-09-20 00:00:00' });
    setIdentityState(db, 'conta2', 'banned');
    setIdentityFlags(db, 'conta3', { controlled: true });
    setIdentityState(db, 'conta4', 'needs-human');
    const p = probeBy({ conta5: offline });
    const plan = await planGoal('Responder comentários', { db, ensureReady: p.ensureReady, providers: PROVIDERS, apiKey: '' });
    expect(plan.tasks.map((t) => [t.identityId, t.readyLabel])).toEqual([
      ['conta3', 'sob controle humano'], ['conta4', 'needs-human'], ['conta5', expect.stringMatching(/^offline · adb: device/)],
    ]);
    expect(plan.tasks[2].readyLabel.length).toBeLessThanOrEqual(60);
    expect(p.seen).toEqual(['conta5']);
    expect(plan.estimate).toMatchObject({ tasks: 0, outOfProbe: 3, fleetReadyMs: 0 });
  });
  it('sonda que lança vira offline, não derruba o plano', async () => {
    const db = fleet(1);
    const plan = await planGoal('Responder comentários', { db, ensureReady: async () => { throw new Error('adb morto'); }, providers: PROVIDERS, apiKey: '' });
    expect(plan.tasks[0]).toMatchObject({ ready: false, readyLabel: 'offline · adb morto', signals: null });
  });
});

describe('deterministicPlan', () => {
  it('fila/lista/menções/N itens → sharding com fatia por identidade pronta', () => {
    const d = deterministicPlan('Tratar a lista de 30 perfis', ['a', 'b']);
    expect(d.pattern).toBe('sharding');
    expect(d.instructions.get('a')).toMatch(/fatia 1 de 2/); expect(d.instructions.get('b')).toMatch(/fatia 2 de 2/);
    for (const t of ['fila de DMs', 'responder menções', '12 itens', '5 menções']) expect(deterministicPlan(t, ['a']).pattern).toBe('sharding');
  });
  it('trabalho preso à conta → fan-out com o texto do objetivo', () => {
    const d = deterministicPlan('Responder comentários da própria caixa', ['a', 'b']);
    expect(d.pattern).toBe('fan-out'); expect(d.instructions.get('b')).toBe('Responder comentários da própria caixa');
  });
});

describe('schema do líder (integrador)', () => {
  it('não leva minLength/maxLength ao json_schema: o Ollama descarta a gramática inteira com eles', async () => {
    const { LeaderOut } = await import('../src/leader/plan.js');
    const json = JSON.stringify(z.toJSONSchema(LeaderOut));
    expect(json).not.toMatch(/minLength|maxLength/);
  });
});
