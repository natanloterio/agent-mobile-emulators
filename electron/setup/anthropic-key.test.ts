import { describe, expect, it } from 'vitest';
import { testAnthropicKey } from './anthropic-key';

const KEY = 'sk-ant-' + 'x'.repeat(30);
const reply = (status: number) => (async () => new Response('{}', { status })) as unknown as typeof fetch;

describe('testAnthropicKey', () => {
  it('200 ok; 401/403 inválida; outro status ou falha de rede = network', async () => {
    expect(await testAnthropicKey(KEY, reply(200))).toEqual({ result: 'ok' });
    expect(await testAnthropicKey(KEY, reply(401))).toEqual({ result: 'invalid' });
    expect(await testAnthropicKey(KEY, reply(403))).toEqual({ result: 'invalid' });
    expect(await testAnthropicKey(KEY, reply(529))).toEqual({ result: 'network' });
    expect(await testAnthropicKey(KEY, (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch)).toEqual({ result: 'network' });
  });
  it('manda a chave no cabeçalho x-api-key para a API de modelos', async () => {
    let seen: { url: string; key: string | undefined } | null = null;
    await testAnthropicKey(KEY, (async (url: unknown, init?: { headers?: Record<string, string> }) => { seen = { url: String(url), key: init?.headers?.['x-api-key'] }; return new Response('{}'); }) as unknown as typeof fetch);
    expect(seen).toEqual({ url: 'https://api.anthropic.com/v1/models?limit=1', key: KEY });
  });
});
