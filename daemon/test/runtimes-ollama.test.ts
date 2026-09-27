import { describe, expect, it } from 'vitest';
import { listOllama, manifestName } from '../src/provider/runtimes/ollama-models.js';

describe('manifestName', () => {
  it('library vira nome:tag; outros namespaces e registries ficam no nome', () => {
    expect(manifestName(['registry.ollama.ai', 'library', 'gpt-oss', '20b'])).toBe('gpt-oss:20b');
    expect(manifestName(['registry.ollama.ai', 'joao', 'meu-modelo', 'latest'])).toBe('joao/meu-modelo:latest');
    expect(manifestName(['hf.co', 'unsloth', 'Qwen3-GGUF', 'Q4_K_M'])).toBe('hf.co/unsloth/Qwen3-GGUF:Q4_K_M');
  });
});

describe('listOllama', () => {
  const tags = { models: [{ name: 'gpt-oss:20b', size: 13_000_000_000 }, { name: 'llama3.2:latest', size: 2_000_000_000 }] };
  const ps = { models: [{ name: 'gpt-oss:20b' }] };
  it('servidor no ar: lista da API com tamanho e o que está carregado', async () => {
    const fetch = (async (u: string) => ({ ok: true, json: async () => (u.endsWith('/api/ps') ? ps : tags) })) as never;
    const r = await listOllama('http://127.0.0.1:11434/v1', { fetch, manifests: () => [], installed: () => true });
    expect(r).toMatchObject({ kind: 'ollama', running: true, installed: true, error: null });
    expect(r.models[0]).toEqual({ id: 'gpt-oss:20b', runtime: 'ollama', label: 'gpt-oss:20b', sizeBytes: 13_000_000_000, loaded: true, toolUse: null });
    expect(r.models[1].loaded).toBe(false);
  });
  it('servidor parado: lista do disco (manifests), aviso de parado', async () => {
    const fetch = (async () => { throw new Error('ECONNREFUSED'); }) as never;
    const r = await listOllama('http://127.0.0.1:11434/v1', { fetch, manifests: () => [{ name: 'qwen3.5:27b', sizeBytes: 17e9 }], installed: () => true });
    expect(r).toMatchObject({ running: false, installed: true, error: expect.stringMatching(/parado/) });
    expect(r.models).toEqual([{ id: 'qwen3.5:27b', runtime: 'ollama', label: 'qwen3.5:27b', sizeBytes: 17e9, loaded: null, toolUse: null }]);
  });
  it('sem Ollama na máquina: não instalado, lista vazia', async () => {
    const fetch = (async () => { throw new Error('ECONNREFUSED'); }) as never;
    const r = await listOllama('http://127.0.0.1:11434/v1', { fetch, manifests: () => [], installed: () => false });
    expect(r).toMatchObject({ installed: false, running: false, models: [] });
  });
});
