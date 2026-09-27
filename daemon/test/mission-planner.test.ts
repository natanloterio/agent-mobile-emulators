import { generateText } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { planNext, plannerPrompt, PlannerError, type PlannerInput } from '../src/mission/planner.js';

const usage = { inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 100, text: 100, reasoning: 0 } };
const json = (o: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(o) }], finishReason: { unified: 'stop' as const }, usage, warnings: [] });
const prose = { content: [{ type: 'text' as const, text: 'vou criar um e-mail primeiro' }], finishReason: { unified: 'stop' as const }, usage, warnings: [] };
const CLOUD = { role: 'lider' as const, mode: 'nuvem' as const, model: 'claude-sonnet-5', endpoint: 'anthropic' };
const PROVIDERS = { lider: CLOUD, worker: { ...CLOUD, role: 'worker' as const }, esc: { ...CLOUD, role: 'esc' as const } };
const EMPTY = { objective: '', success_criteria: '', rationale: '', summary: '', reason: '' };
const input: PlannerInput = {
  missionText: 'crie um e-mail, depois uma conta no Instagram e faça login',
  identity: { name: 'conta2', handle: 'sem conta', appPackage: 'com.instagram.android' },
  memory: [{ key: 'email.address', value: 'x@y.z', secret: false }, { key: 'email.password', value: 'mission:m:email.password', secret: true }],
  subtasks: [{ id: 't1', seq: 1, objective: 'conseguir e-mail no Gmail', successCriteria: 'caixa aberta', state: 'failed', report: { ok: false, did: 'abriu o cadastro', blockers: 'pediu telefone' }, costUsd: 0.1 }],
  screen: 'app: com.android.chrome\n- Criar conta', lang: 'pt',
};

describe('planejador da missão', () => {
  it('prompt traz missão, memória (segredo só pela chave), histórico com relatório e tela', () => {
    const p = plannerPrompt(input);
    expect(p).toContain('crie um e-mail');
    expect(p).toContain('email.address: x@y.z');
    expect(p).toContain('email.password: (segredo)');
    expect(p).not.toContain('mission:m:email.password');
    expect(p).toContain('#1 [failed] conseguir e-mail no Gmail');
    expect(p).toContain('pediu telefone');
    expect(p).toContain('app: com.android.chrome');
  });
  it('lista as rotas já falhadas (objetivo de cada subtarefa failed) numa linha própria', () => {
    const twoFailed: PlannerInput = { ...input, subtasks: [
      ...input.subtasks,
      { id: 't2', seq: 2, objective: 'criar e-mail no Outlook', successCriteria: 'caixa aberta', state: 'failed', report: { ok: false, did: '', blockers: 'pediu telefone' }, costUsd: 0.1 },
      { id: 't3', seq: 3, objective: 'abrir o Instagram', successCriteria: 'logado', state: 'done', report: { ok: true, did: 'logou', blockers: '' }, costUsd: 0.1 },
    ] };
    const p = plannerPrompt(twoFailed);
    expect(p).toMatch(/Rotas que já falharam:.*conseguir e-mail no Gmail.*criar e-mail no Outlook/s);
    expect(p).not.toMatch(/Rotas que já falharam:.*abrir o Instagram/s);
  });
  it('next vira decisão com objetivo e critério; custo calculado', async () => {
    const model = new MockLanguageModelV4({ doGenerate: [json({ ...EMPTY, decision: 'next', objective: 'criar e-mail no Outlook', success_criteria: 'caixa de entrada aberta', rationale: 'Gmail pediu telefone' })] as never });
    const r = await planNext(input, { providers: PROVIDERS, model });
    expect(r.decision).toEqual({ kind: 'next', objective: 'criar e-mail no Outlook', successCriteria: 'caixa de entrada aberta', rationale: 'Gmail pediu telefone' });
    expect(r.costUsd).toBeGreaterThan(0);
  });
  it('done e human', async () => {
    const done = new MockLanguageModelV4({ doGenerate: [json({ ...EMPTY, decision: 'done', summary: 'conta criada e logada' })] as never });
    expect((await planNext(input, { providers: PROVIDERS, model: done })).decision).toEqual({ kind: 'done', summary: 'conta criada e logada' });
    const human = new MockLanguageModelV4({ doGenerate: [json({ ...EMPTY, decision: 'human', reason: 'todos os provedores pediram telefone' })] as never });
    expect((await planNext(input, { providers: PROVIDERS, model: human })).decision).toEqual({ kind: 'human', reason: 'todos os provedores pediram telefone' });
  });
  it('prosa na primeira, JSON na segunda → segunda tentativa vale', async () => {
    const model = new MockLanguageModelV4({ doGenerate: [prose, json({ ...EMPTY, decision: 'done', summary: 'ok' })] as never });
    expect((await planNext(input, { providers: PROVIDERS, model })).decision.kind).toBe('done');
  });
  it('next sem objetivo duas vezes → PlannerError', async () => {
    const bad = json({ ...EMPTY, decision: 'next' });
    const model = new MockLanguageModelV4({ doGenerate: [bad, bad] as never });
    await expect(planNext(input, { providers: PROVIDERS, model })).rejects.toBeInstanceOf(PlannerError);
  });
  it('instruções pedem trocar de rota após falha em vez de repetir objetivo/site/provedor', async () => {
    let seenInstructions = '';
    const generate = (async (o: { instructions: string }) => {
      seenInstructions = o.instructions;
      return { output: { ...EMPTY, decision: 'done', summary: 'ok' }, totalUsage: { inputTokens: 100, outputTokens: 20 } };
    }) as unknown as typeof generateText;
    await planNext(input, { providers: PROVIDERS, generate, model: {} as never });
    expect(seenInstructions).toMatch(/Não proponha de novo o mesmo objetivo, site ou provedor de uma subtarefa que falhou/);
    expect(seenInstructions).toMatch(/decida "human"/);
  });
});
