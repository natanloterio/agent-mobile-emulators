import { describe, expect, it } from 'vitest';
import { AnthropicKeySchema, FinishRequestSchema, InstallRequestSchema } from './requests.js';

const KEY = 'sk-ant-' + 'x'.repeat(30);

describe('schemas do IPC de setup', () => {
  it('install aceita jobs conhecidos e nome de modelo do Ollama', () => {
    expect(InstallRequestSchema.parse({ jobs: ['img', 'model'], localModel: 'gpt-oss:20b' })).toEqual({ jobs: ['img', 'model'], localModel: 'gpt-oss:20b' });
  });
  it('install recusa job desconhecido, modelo com espaço ou barra, e campo a mais', () => {
    expect(() => InstallRequestSchema.parse({ jobs: ['rm -rf'], localModel: 'gpt-oss:20b' })).toThrow();
    expect(() => InstallRequestSchema.parse({ jobs: [], localModel: 'gpt oss' })).toThrow();
    expect(() => InstallRequestSchema.parse({ jobs: [], localModel: '../x' })).toThrow();
    expect(() => InstallRequestSchema.parse({ jobs: [], localModel: 'qwen3:14b', x: 1 })).toThrow();
  });
  it('finish aceita chave nula e recusa chave malformada', () => {
    expect(FinishRequestSchema.parse({ mode: 'nuvem', localModel: 'gpt-oss:20b', anthropicKey: null, applyRoles: true }).anthropicKey).toBeNull();
    expect(FinishRequestSchema.parse({ mode: 'misto', localModel: 'gpt-oss:20b', anthropicKey: ` ${KEY} `, applyRoles: false }).anthropicKey).toBe(KEY);
    expect(() => FinishRequestSchema.parse({ mode: 'misto', localModel: 'gpt-oss:20b', anthropicKey: 'abc', applyRoles: true })).toThrow();
    expect(() => FinishRequestSchema.parse({ mode: 'tudo', localModel: 'gpt-oss:20b', anthropicKey: null, applyRoles: true })).toThrow();
  });
  it('finish exige applyRoles booleano', () => {
    expect(() => FinishRequestSchema.parse({ mode: 'misto', localModel: 'gpt-oss:20b', anthropicKey: null })).toThrow();
    expect(() => FinishRequestSchema.parse({ mode: 'misto', localModel: 'gpt-oss:20b', anthropicKey: null, applyRoles: 'sim' })).toThrow();
  });
  it('chave sozinha (Testar chave)', () => {
    expect(AnthropicKeySchema.parse(KEY)).toBe(KEY);
    expect(() => AnthropicKeySchema.parse('sk-ant-curta')).toThrow();
  });
});
