import { tool } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { openDb } from '../src/db/open.js';
import { upsertIdentity } from '../src/db/identities.js';
import { createOllamaSupervisor } from '../src/provider/ollama.js';
import { lastProviderTests, recordProviderTest, testProvider } from '../src/provider/probe.js';

const row = { id: 'conta1', name: 'conta1', handle: '@a', avdName: 'x', serial: 's', consolePort: 5554, mcpHostPort: 8080, mcpToken: 't', deviceSlug: 'conta1', appPackage: 'p', appVersionName: '1', state: 'idle' as const };
const LOCAL = { role: 'worker' as const, mode: 'local' as const, model: 'qwen3.5:27b', endpoint: 'http://127.0.0.1:11434/v1' };
const usage = { inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 40, text: 40, reasoning: 0 } };
const screenCall = (input: string) => ({ content: [{ type: 'tool-call' as const, toolCallId: 'c1', toolName: 'android_conta1_get_screen_state', input }], finishReason: { unified: 'tool-calls' as const }, usage, warnings: [] });
const SCREEN = 'screen:1080x2400 density:420 orientation:portrait\n--- window:1 type:APPLICATION pkg:p title:t layer:0 focused:true ---\nnode_id\tclass\ttext\tdesc\tres_id\tbounds\tflags\nn1\tTextView\tx\t-\t-\t0,0,1,1\ton\n';
const seen: string[] = [];
const connect = async () => ({ tools: async () => ({
  android_conta1_get_screen_state: tool({ description: 't', inputSchema: z.object({ include_screenshot: z.boolean().optional() }), execute: async () => { seen.push('screen'); return SCREEN; } }),
  android_conta1_tap_node: tool({ description: 't', inputSchema: z.object({ node_id: z.string() }), execute: async () => { seen.push('tap'); return 'no'; } }),
}), close: async () => {} });
const external = () => createOllamaSupervisor({ fetch: (async () => new Response(JSON.stringify({ models: [{ name: 'qwen3.5:27b' }] }))) as never });

describe('testProvider', () => {
  it('chama só get_screen_state com toolChoice required, mede e grava provider_test', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const model = new MockLanguageModelV4({ doGenerate: [screenCall('{}')] as never });
    const t = await testProvider(db, LOCAL, row, {}, { connect, model, ollama: external() });
    expect(t).toMatchObject({ role: 'worker', model: 'qwen3.5:27b', argsValid: true, error: null });
    expect(t.latencyMs).toBeGreaterThanOrEqual(0);
    expect(model.doGenerateCalls[0].toolChoice).toEqual({ type: 'required' });
    expect(model.doGenerateCalls[0].tools?.map((x) => x.name)).toEqual(['android_conta1_get_screen_state']);
    expect(seen).toEqual(['screen']);
    expect(lastProviderTests(db).worker).toMatchObject({ argsValid: true });
    expect((db.prepare('select count(*) as n from step').get() as { n: number }).n).toBe(0);
  });
  it('argumentos inválidos → argsValid false, sem erro', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const model = new MockLanguageModelV4({ doGenerate: [screenCall('{not json')] as never });
    const t = await testProvider(db, LOCAL, row, {}, { connect, model, ollama: external() });
    expect(t.argsValid).toBe(false); expect(t.error).toBeNull();
  });
  it('Ollama externo (não subido pelo daemon) → warning de contexto desconhecido (Review Focus 1)', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const model = new MockLanguageModelV4({ doGenerate: [screenCall('{}')] as never });
    const t = await testProvider(db, LOCAL, row, {}, { connect, model, ollama: external() });
    expect(t.warning).toMatch(/contexto desconhecido/);
  });
  it('Ollama sem o modelo → error infra-local com instrução de pull, gravado', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const missing = createOllamaSupervisor({ fetch: (async () => new Response(JSON.stringify({ models: [{ name: 'gemma4:12b' }] }))) as never });
    const t = await testProvider(db, LOCAL, row, {}, { connect, model: new MockLanguageModelV4({ doGenerate: [] as never }), ollama: missing });
    expect(t.argsValid).toBe(false); expect(t.error).toMatch(/ollama pull qwen3\.5:27b/);
    expect((db.prepare('select error from provider_test').get() as { error: string }).error).toMatch(/pull/);
  });
  it('nuvem sem chave → error auth', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const t = await testProvider(db, { role: 'esc', mode: 'nuvem', model: 'claude-haiku-4-5', endpoint: 'anthropic' }, row, {}, { connect });
    expect(t.error).toMatch(/ANTHROPIC_API_KEY/); expect(t.argsValid).toBe(false);
  });
});

describe('probe — três desfechos (incremento 3, spec §4.3)', () => {
  const mcpErr = { isError: true, content: [{ type: 'text', text: 'Error executing tool: accessibility service disabled' }] };
  const connectWith = (exec: () => Promise<unknown>) => async () => ({ tools: async () => ({
    android_conta1_get_screen_state: tool({ description: 't', inputSchema: z.object({ include_screenshot: z.boolean().optional() }), execute: exec }),
  }), close: async () => {} });
  it('tool executou mas o MCP devolveu isError → argsValid false e error "MCP: …"', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const t = await testProvider(db, LOCAL, row, {}, { connect: connectWith(async () => mcpErr), model: new MockLanguageModelV4({ doGenerate: [screenCall('{}')] as never }), ollama: external() });
    expect(t.argsValid).toBe(false); expect(t.error).toMatch(/^MCP: .*accessibility/);
  });
  it('tool lançou → argsValid false e error "infra: …" (não "argumentos inválidos")', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const t = await testProvider(db, LOCAL, row, {}, { connect: connectWith(async () => { throw new Error("device 'emulator-5554' not found"); }), model: new MockLanguageModelV4({ doGenerate: [screenCall('{}')] as never }), ollama: external() });
    expect(t.argsValid).toBe(false); expect(t.error).toMatch(/^infra: .*not found/);
  });
  it('at gravado é o mesmo ISO devolvido', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const t = await testProvider(db, LOCAL, row, {}, { connect, model: new MockLanguageModelV4({ doGenerate: [screenCall('{}')] as never }), ollama: external() });
    expect(lastProviderTests(db).worker?.at).toBe(t.at); expect(t.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('recordProviderTest (revisão final, Important 5)', () => {
  it('grava um resultado produzido fora do probe (identidade não pronta) e ele aparece em lastProviderTests', () => {
    const db = openDb(':memory:');
    const t = recordProviderTest(db, { role: 'worker', model: 'm', latencyMs: 0, tokensPerSec: null, argsValid: false, warning: null, error: 'identidade não pronta: boot', at: 'x' });
    expect(t.error).toMatch(/não pronta/);
    expect(lastProviderTests(db).worker).toMatchObject({ argsValid: false, error: 'identidade não pronta: boot' });
  });
});
