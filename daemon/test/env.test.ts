import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config.js';

describe('loadEnv: chave da Anthropic opcional', () => {
  it('sem chave ou vazia: sobe com chave vazia (só modelos locais)', () => {
    expect(loadEnv({})).toEqual({ anthropicApiKey: '' });
    expect(loadEnv({ ANTHROPIC_API_KEY: '  ' })).toEqual({ anthropicApiKey: '' });
  });
  it('chave válida passa; chave curta é erro de digitação', () => {
    expect(loadEnv({ ANTHROPIC_API_KEY: 'sk-ant-' + 'x'.repeat(30) }).anthropicApiKey).toMatch(/^sk-ant-/);
    expect(() => loadEnv({ ANTHROPIC_API_KEY: 'abc' })).toThrow(/curta demais/);
  });
});
