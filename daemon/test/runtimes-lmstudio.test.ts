import { describe, expect, it } from 'vitest';
import { createLmStudio, parseLmsLs } from '../src/provider/runtimes/lmstudio.js';

const LS = `Waking up LM Studio service...\n[{"type":"llm","modelKey":"google/gemma-4-12b-qat","displayName":"Gemma 4 12B Qat","sizeBytes":7151066820,"trainedForToolUse":true},
{"type":"embedding","modelKey":"text-embedding-nomic","displayName":"Nomic","sizeBytes":84000000},
{"type":"llm","modelKey":"llama-3.2-3b-instruct","displayName":"Llama 3.2 3B","sizeBytes":2020000000,"trainedForToolUse":false}]`;
const V0 = (state: Record<string, string>) => ({ data: Object.entries(state).map(([id, s]) => ({ id, state: s, type: 'llm', capabilities: ['tool_use'] })) });

function fakes(o: { running?: boolean; loaded?: string[]; lms?: boolean } = {}) {
  let running = o.running ?? true; const loaded = new Set(o.loaded ?? []); const calls: string[] = [];
  const exec = async (_f: string, args: readonly string[]) => {
    calls.push(args.join(' '));
    if (args[0] === 'ls') return { stdout: LS, stderr: '', code: 0 };
    if (args[0] === 'server' && args[1] === 'start') { running = true; return { stdout: '', stderr: '', code: 0 }; }
    if (args[0] === 'load') { loaded.add(args[1]); return { stdout: '', stderr: '', code: 0 }; }
    return { stdout: '', stderr: '', code: 0 };
  };
  const fetch = (async (u: string) => {
    if (!running) throw new Error('ECONNREFUSED');
    const ids = ['google/gemma-4-12b-qat', 'llama-3.2-3b-instruct'];
    return { ok: true, json: async () => (u.endsWith('/api/v0/models') ? V0(Object.fromEntries(ids.map((i) => [i, loaded.has(i) ? 'loaded' : 'not-loaded']))) : { data: ids.map((id) => ({ id })) }) };
  }) as never;
  return { exec, fetch, calls, lmsPath: o.lms === false ? null : '/x/lms' };
}

describe('parseLmsLs', () => {
  it('ignora o texto antes do JSON e os modelos de embedding', () => {
    expect(parseLmsLs(LS).map((m) => m.id)).toEqual(['google/gemma-4-12b-qat', 'llama-3.2-3b-instruct']);
    expect(parseLmsLs(LS)[0]).toMatchObject({ label: 'Gemma 4 12B Qat', sizeBytes: 7151066820, toolUse: true, runtime: 'lmstudio' });
    expect(parseLmsLs('lixo')).toEqual([]);
  });
});

describe('LM Studio', () => {
  it('lista pelo CLI e marca o que está carregado pela API', async () => {
    const f = fakes({ loaded: ['llama-3.2-3b-instruct'] });
    const r = await createLmStudio({ exec: f.exec, fetch: f.fetch, lmsPath: f.lmsPath, sleep: async () => {} }).list('http://127.0.0.1:1234/v1');
    expect(r).toMatchObject({ kind: 'lmstudio', installed: true, running: true, error: null });
    expect(r.models.map((m) => [m.id, m.loaded])).toEqual([['google/gemma-4-12b-qat', false], ['llama-3.2-3b-instruct', true]]);
  });
  it('servidor parado: lista pelo CLI, loaded desconhecido e aviso', async () => {
    const f = fakes({ running: false });
    const r = await createLmStudio({ exec: f.exec, fetch: f.fetch, lmsPath: f.lmsPath, sleep: async () => {} }).list('http://127.0.0.1:1234/v1');
    expect(r).toMatchObject({ running: false, error: expect.stringMatching(/parado/) });
    expect(r.models[0].loaded).toBeNull();
  });
  it('sem CLI e sem servidor: não instalado', async () => {
    const f = fakes({ running: false, lms: false });
    const r = await createLmStudio({ exec: f.exec, fetch: f.fetch, lmsPath: null, sleep: async () => {} }).list('http://127.0.0.1:1234/v1');
    expect(r).toMatchObject({ installed: false, models: [] });
  });
  it('ensure: sobe o servidor na porta do endpoint e carrega o modelo com contexto de 32k', async () => {
    const f = fakes({ running: false });
    const lm = createLmStudio({ exec: f.exec, fetch: f.fetch, lmsPath: f.lmsPath, sleep: async () => {} });
    const st = await lm.ensure('http://127.0.0.1:1234/v1', 'google/gemma-4-12b-qat');
    expect(f.calls).toEqual(expect.arrayContaining(['server start --port 1234', 'load google/gemma-4-12b-qat --context-length 32768 -y']));
    expect(st).toMatchObject({ running: true, spawnedByUs: true });
  });
  it('ensure: modelo que não está baixado é erro claro; já carregado não recarrega', async () => {
    const f = fakes({ loaded: ['llama-3.2-3b-instruct'] });
    const lm = createLmStudio({ exec: f.exec, fetch: f.fetch, lmsPath: f.lmsPath, sleep: async () => {} });
    await expect(lm.ensure('http://127.0.0.1:1234/v1', 'nao/existe')).rejects.toThrow(/não está baixado no LM Studio/);
    await lm.ensure('http://127.0.0.1:1234/v1', 'llama-3.2-3b-instruct');
    expect(f.calls.some((c) => c.startsWith('load'))).toBe(false);
  });
  it('ensure recusa endpoint remoto parado (o daemon só sobe processo local)', async () => {
    const f = fakes({ running: false });
    const lm = createLmStudio({ exec: f.exec, fetch: f.fetch, lmsPath: f.lmsPath, sleep: async () => {} });
    await expect(lm.ensure('http://10.0.0.5:1234/v1', 'llama-3.2-3b-instruct')).rejects.toThrow(/remoto/);
  });
});
