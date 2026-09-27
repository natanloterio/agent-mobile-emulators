import { describe, expect, it } from 'vitest';
import { createLocalRuntimes } from '../src/provider/runtimes/local.js';

const status = { running: true, spawnedByUs: false, adopted: false, pid: null, models: [] };
function fakes() {
  const calls: string[] = [];
  const ollama = { ensure: async (e: string, m: string) => { calls.push(`ollama ${e} ${m}`); return status; }, unload: async (_e: string, m: string) => { calls.push(`ollama unload ${m}`); }, stop: () => { calls.push('ollama stop'); }, status: () => null };
  const lmstudio = {
    ensure: async (e: string, m: string) => { calls.push(`lm ${e} ${m}`); return status; }, stop: () => { calls.push('lm stop'); },
    unload: async (_e: string, m: string) => { calls.push(`lm unload ${m}`); },
    list: async (e: string) => ({ kind: 'lmstudio' as const, label: 'LM Studio', endpoint: e, installed: true, running: false, error: 'parado', models: [{ id: 'g', runtime: 'lmstudio' as const, label: 'G', sizeBytes: 1, loaded: null, toolUse: true }] }),
  };
  const listOllama = async (e: string) => ({ kind: 'ollama' as const, label: 'Ollama', endpoint: e, installed: true, running: true, error: null, models: [{ id: 'gpt-oss:20b', runtime: 'ollama' as const, label: 'gpt-oss:20b', sizeBytes: 13, loaded: true, toolUse: null }] });
  return { calls, rt: createLocalRuntimes({ ollama, lmstudio, listOllama }) };
}

describe('createLocalRuntimes', () => {
  it('ensure despacha pelo runtime; sem runtime, a porta decide', async () => {
    const f = fakes();
    await f.rt.ensure('http://127.0.0.1:1234/v1', 'g', 'lmstudio');
    await f.rt.ensure('http://127.0.0.1:11434/v1', 'gpt-oss:20b', 'ollama');
    await f.rt.ensure('http://127.0.0.1:1234/v1', 'g');
    expect(f.calls).toEqual(['lm http://127.0.0.1:1234/v1 g', 'ollama http://127.0.0.1:11434/v1 gpt-oss:20b', 'lm http://127.0.0.1:1234/v1 g']);
  });
  it('listAll junta os dois; o runtime do papel usa o endpoint dele, o outro o default', async () => {
    const f = fakes();
    const all = await f.rt.listAll({ runtime: 'ollama', endpoint: 'http://127.0.0.1:11500/v1' });
    expect(all.map((r) => [r.kind, r.endpoint])).toEqual([['ollama', 'http://127.0.0.1:11500/v1'], ['lmstudio', 'http://127.0.0.1:1234/v1']]);
    expect(all.flatMap((r) => r.models.map((m) => m.id))).toEqual(['gpt-oss:20b', 'g']);
  });
  it('stop para os dois (cada um só derruba o que subiu)', () => {
    const f = fakes(); f.rt.stop();
    expect(f.calls).toEqual(['ollama stop', 'lm stop']);
  });
});

describe('unload despacha pelo runtime (integrador)', () => {
  it('LM Studio e Ollama', async () => {
    const f = fakes();
    await f.rt.unload('http://127.0.0.1:1234/v1', 'g', 'lmstudio'); await f.rt.unload('http://127.0.0.1:11434/v1', 'gpt-oss:20b', 'ollama');
    expect(f.calls).toEqual(['lm unload g', 'ollama unload gpt-oss:20b']);
  });
});
