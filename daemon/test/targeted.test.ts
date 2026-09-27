import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { upsertIdentity, type IdentityRow } from '../src/db/identities.js';
import type { ProbeResult } from '../src/device/probe.js';
import { mentionedIdentities, planGoal } from '../src/leader/plan.js';
import { PROVIDER_DEFAULTS } from '../src/provider/config.js';

const base: IdentityRow = { id: 'conta1', name: 'conta1', handle: '@p1t41a.meta.test', avdName: 'a', serial: 'emulator-5554', consolePort: 5554, mcpHostPort: 8080, mcpToken: 't', deviceSlug: 'conta1', appPackage: 'p', appVersionName: 'v', state: 'idle' };
const ids = [base, { ...base, id: 'conta2', name: 'conta2', handle: '@papaia', serial: 'emulator-5556' }, { ...base, id: 'conta10', name: 'conta10', handle: '@loja.sul' }];
const READY: ProbeResult = { ready: true, signals: { bootCompleted: true, accessibility: true, mcpInitialize: true, toolsPresent: true, versionMatch: true }, details: [], failureClass: null };

describe('mentionedIdentities', () => {
  it('casa nome ou @ inteiros; "papaia.me" não é o @papaia; conta1 não casa conta10', () => {
    const m = (t: string) => mentionedIdentities(t, ids).map((i) => i.id);
    expect(m('tente fazer login na @conta2 no instagram com o username papaia.me e senha 123455')).toEqual(['conta2']);
    expect(m('responder comentários do @papaia e da conta10')).toEqual(['conta2', 'conta10']);
    expect(m('responder comentários do @p1t41a.meta.test')).toEqual(['conta1']);
    expect(m('responder comentários em todas as contas')).toEqual([]);
  });
});

describe('planGoal com identidades citadas', () => {
  it('só as citadas são sondadas e entram no plano; o líder só vê as citadas; as outras ficam "fora do objetivo"', async () => {
    const db = openDb(':memory:'); for (const i of ids) upsertIdentity(db, i);
    const probed: string[] = [];
    const json = (o: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(o) }], finishReason: { unified: 'stop' as const }, usage: { inputTokens: { total: 1, noCache: 1 }, outputTokens: { total: 1, text: 1 } }, warnings: [] });
    const model = new MockLanguageModelV4({ doGenerate: [json({ pattern: 'fan-out', rationale: 'r', instructions: [{ identityId: 'conta1', instruction: 'errado' }, { identityId: 'conta2', instruction: 'verificar a sessão' }] })] as never });
    const plan = await planGoal('verificar a sessão da @conta2', { db, model, apiKey: 'k', providers: PROVIDER_DEFAULTS, ensureReady: async (i) => { probed.push(i.id); return READY; } });
    expect(probed).toEqual(['conta2']);
    expect(plan.tasks.map((t) => [t.identityId, t.ready, t.readyLabel])).toEqual([['conta1', false, 'fora do objetivo'], ['conta10', false, 'fora do objetivo'], ['conta2', true, 'pronto']]);
    expect(plan.tasks.find((t) => t.identityId === 'conta1')?.instruction).not.toBe('errado');
    expect(JSON.stringify(model.doGenerateCalls[0].prompt)).not.toMatch(/p1t41a/);
    expect(plan.estimate).toMatchObject({ tasks: 1 });
  });
});
