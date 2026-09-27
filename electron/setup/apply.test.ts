import { describe, expect, it } from 'vitest';
import { providerPatches } from './apply';

const LOCAL = { mode: 'local', model: 'qwen3:14b', endpoint: 'http://127.0.0.1:11434/v1', runtime: 'ollama' };

describe('providerPatches', () => {
  it('misto: líder e escalada na nuvem, agentes locais', () => {
    expect(providerPatches('misto', 'qwen3:14b')).toEqual({
      lider: { mode: 'nuvem', model: 'claude-sonnet-5' }, worker: LOCAL, esc: { mode: 'nuvem', model: 'claude-haiku-4-5' },
    });
  });
  it('local: os três no Ollama com o modelo escolhido', () => {
    expect(providerPatches('local', 'qwen3:14b')).toEqual({ lider: LOCAL, worker: LOCAL, esc: LOCAL });
  });
  it('nuvem: os três na Anthropic', () => {
    expect(providerPatches('nuvem', 'qwen3:14b')).toEqual({
      lider: { mode: 'nuvem', model: 'claude-sonnet-5' }, worker: { mode: 'nuvem', model: 'claude-haiku-4-5' }, esc: { mode: 'nuvem', model: 'claude-haiku-4-5' },
    });
  });
});
