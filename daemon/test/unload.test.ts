import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { modelsToUnload, PROVIDER_DEFAULTS, type ProviderConfig } from '../src/provider/config.js';
import { startServer } from '../src/server/api.js';

const local = (role: 'lider' | 'worker' | 'esc', model: string, runtime: 'ollama' | 'lmstudio' = 'ollama') =>
  ({ role, mode: 'local' as const, model, endpoint: runtime === 'ollama' ? 'http://127.0.0.1:11434/v1' : 'http://127.0.0.1:1234/v1', runtime });
const cfg = (l: ReturnType<typeof local> | typeof PROVIDER_DEFAULTS.lider, w: ReturnType<typeof local>, e: ReturnType<typeof local> | typeof PROVIDER_DEFAULTS.esc): ProviderConfig => ({ lider: { ...l, role: 'lider' }, worker: w, esc: { ...e, role: 'esc' } });

describe('modelsToUnload', () => {
  it('modelo que saiu de todos os papéis é descarregado; o que outro papel ainda usa fica', () => {
    const before = cfg(local('lider', 'gpt-oss:20b'), local('worker', 'gpt-oss:20b'), PROVIDER_DEFAULTS.esc);
    expect(modelsToUnload(before, cfg(local('lider', 'gpt-oss:20b'), local('worker', 'gemma4:12b'), PROVIDER_DEFAULTS.esc))).toEqual([]);
    const out = modelsToUnload(before, cfg(PROVIDER_DEFAULTS.lider, local('worker', 'gemma4:12b'), PROVIDER_DEFAULTS.esc));
    expect(out.map((r) => [r.model, r.runtime])).toEqual([['gpt-oss:20b', 'ollama']]);
  });
  it('mesmo nome em runtime diferente conta como outro modelo; nuvem nunca é descarregada', () => {
    const before = cfg(PROVIDER_DEFAULTS.lider, local('worker', 'llama', 'lmstudio'), PROVIDER_DEFAULTS.esc);
    expect(modelsToUnload(before, cfg(PROVIDER_DEFAULTS.lider, local('worker', 'llama', 'ollama'), PROVIDER_DEFAULTS.esc)).map((r) => r.runtime)).toEqual(['lmstudio']);
    expect(modelsToUnload(cfg(PROVIDER_DEFAULTS.lider, local('worker', 'a'), PROVIDER_DEFAULTS.esc), cfg(PROVIDER_DEFAULTS.lider, local('worker', 'a'), PROVIDER_DEFAULTS.esc))).toEqual([]);
  });
});

describe('PUT /providers descarrega o anterior', () => {
  it('trocar o modelo do worker chama unloadLocal com o modelo que saiu', async () => {
    const db = openDb(':memory:'); const unloaded: string[] = [];
    const s = await startServer({ db, port: 0, token: 'seg', onGoal: async () => ({ goalId: 'g', done: Promise.resolve() }) as never, onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); }, unloadLocal: async (r) => { unloaded.push(`${r.runtime}:${r.model}`); } });
    try {
      const r = await fetch(`http://127.0.0.1:${s.port}/providers/worker`, { method: 'PUT', headers: { authorization: 'Bearer seg', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'gemma4:12b' }) });
      expect(r.status).toBe(200);
      await new Promise((res) => setTimeout(res, 10));
      expect(unloaded).toEqual(['ollama:gpt-oss:20b']);
    } finally { await s.close(); }
  });
});
