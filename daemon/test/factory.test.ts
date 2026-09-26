import { generateText } from 'ai';
import { describe, expect, it } from 'vitest';
import { ProviderError } from '../src/provider/errors.js';
import { buildModel, LOCAL_PRICING, pricingFor, providerOptionsFor } from '../src/provider/factory.js';
import { HAIKU_PRICING } from '../src/worker/record.js';

const local = { role: 'worker' as const, mode: 'local' as const, model: 'qwen3.5:27b', endpoint: 'http://127.0.0.1:11434/v1' };
const cloud = { role: 'esc' as const, mode: 'nuvem' as const, model: 'claude-haiku-4-5', endpoint: 'anthropic' };

/** fetch falso que responde uma chat completion mínima e grava a URL/corpo chamados. */
function fakeOpenAI() {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetchFn = (async (input: unknown, init?: { body?: string }) => {
    calls.push({ url: String(input), body: JSON.parse(init?.body ?? '{}') });
    const body = { id: 'x', object: 'chat.completion', created: 0, model: 'qwen3.5:27b',
      choices: [{ index: 0, message: { role: 'assistant', content: 'oi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 } };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

describe('buildModel', () => {
  it('local → openai-compatible batendo em {endpoint}/chat/completions com o modelo do registro', async () => {
    const { fetchFn, calls } = fakeOpenAI();
    const model = buildModel(local, {}, { fetch: fetchFn });
    const r = await generateText({ model, prompt: 'x' });
    expect(r.text).toBe('oi');
    expect(calls[0].url).toBe('http://127.0.0.1:11434/v1/chat/completions');
    expect(calls[0].body.model).toBe('qwen3.5:27b');
    expect(r.usage.inputTokens).toBe(5);
  });
  it('nuvem → anthropic com a chave; sem chave lança ProviderError auth antes de chamar', () => {
    const m = buildModel(cloud, { anthropicApiKey: 'sk-ant-test-0000000000000000' });
    expect(m.provider).toMatch(/anthropic/); expect(m.modelId).toBe('claude-haiku-4-5');
    expect(() => buildModel(cloud, {})).toThrow(ProviderError);
    try { buildModel(cloud, {}); } catch (e) { expect((e as ProviderError).kind).toBe('auth'); }
  });
  it('providerOptions e pricing dependem do modo', () => {
    expect(providerOptionsFor(cloud)).toEqual({ anthropic: { disableParallelToolUse: true, cacheControl: { type: 'ephemeral', ttl: '1h' } } });
    expect(providerOptionsFor(local)).toEqual({});
    expect(pricingFor(cloud)).toBe(HAIKU_PRICING); expect(pricingFor(local)).toBe(LOCAL_PRICING);
  });
});
