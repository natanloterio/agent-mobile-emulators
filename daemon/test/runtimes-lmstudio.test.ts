import { describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../src/config.js';
import { createLmStudio, findLms, parseLmsLs } from '../src/provider/runtimes/lmstudio.js';

const LS = `Waking up LM Studio service...\n[{"type":"llm","modelKey":"google/gemma-4-12b-qat","displayName":"Gemma 4 12B Qat","sizeBytes":7151066820,"trainedForToolUse":true},
{"type":"embedding","modelKey":"text-embedding-nomic","displayName":"Nomic","sizeBytes":84000000},
{"type":"llm","modelKey":"llama-3.2-3b-instruct","displayName":"Llama 3.2 3B","sizeBytes":2020000000,"trainedForToolUse":false}]`;
const V0 = (state: Record<string, string>) => ({ data: Object.entries(state).map(([id, s]) => ({ id, state: s, type: 'llm', capabilities: ['tool_use'] })) });

function fakes(o: { running?: boolean; loaded?: string[]; lms?: boolean; ctx?: number; parallel?: number | null } = {}) {
  let running = o.running ?? true; const loaded = new Set(o.loaded ?? []); const calls: string[] = [];
  // Contexto relatado por `lms ps` de cada modelo carregado; um `load --context-length N` atualiza (simula recarregar de verdade).
  const ctxByModel = new Map<string, number>((o.loaded ?? []).map((m) => [m, o.ctx ?? CONFIG.local.contextLength]));
  // Paralelismo relatado por `lms ps` (campo `parallel`); `null`/ausente = desconhecido (config sem --parallel).
  const parallelByModel = new Map<string, number | null>((o.loaded ?? []).map((m) => [m, o.parallel === undefined ? null : o.parallel]));
  const exec = async (_f: string, args: readonly string[]) => {
    calls.push(args.join(' '));
    if (args[0] === 'ls') return { stdout: LS, stderr: '', code: 0 };
    if (args[0] === 'server' && args[1] === 'start') { running = true; return { stdout: '', stderr: '', code: 0 }; }
    if (args[0] === 'load') {
      loaded.add(args[1]);
      const flag = args.indexOf('--context-length');
      ctxByModel.set(args[1], flag >= 0 ? Number(args[flag + 1]) : (o.ctx ?? CONFIG.local.contextLength));
      const pFlag = args.indexOf('--parallel');
      parallelByModel.set(args[1], pFlag >= 0 ? Number(args[pFlag + 1]) : null);
      return { stdout: '', stderr: '', code: 0 };
    }
    if (args[0] === 'unload') { loaded.delete(args[1]); return { stdout: '', stderr: '', code: 0 }; }
    if (args[0] === 'ps') return {
      stdout: JSON.stringify([...loaded].map((k) => ({
        modelKey: k, identifier: k, contextLength: ctxByModel.get(k) ?? (o.ctx ?? CONFIG.local.contextLength),
        parallel: parallelByModel.get(k) ?? null,
      }))), stderr: '', code: 0,
    };
    return { stdout: '', stderr: '', code: 0 };
  };
  const fetch = (async (u: string, init?: { method?: string; body?: string }) => {
    if (!running) throw new Error('ECONNREFUSED');
    if (init?.method === 'POST' && u.endsWith('/api/v1/models/unload')) {
      const id = (JSON.parse(init.body ?? '{}') as { instance_id: string }).instance_id;
      calls.push(`rest-unload ${id}`); loaded.delete(id);
      return { ok: true, status: 200, json: async () => ({ instance_id: id }) };
    }
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
    expect(r).toMatchObject({ running: false, error: null });
    expect(r.models[0].loaded).toBeNull();
  });
  it('sem CLI e sem servidor: não instalado', async () => {
    const f = fakes({ running: false, lms: false });
    const r = await createLmStudio({ exec: f.exec, fetch: f.fetch, lmsPath: null, sleep: async () => {} }).list('http://127.0.0.1:1234/v1');
    expect(r).toMatchObject({ installed: false, models: [] });
  });
  it('ensure: sobe o servidor na porta do endpoint e carrega o modelo com o contexto e o paralelismo configurados', async () => {
    const f = fakes({ running: false });
    const lm = createLmStudio({ exec: f.exec, fetch: f.fetch, lmsPath: f.lmsPath, sleep: async () => {} });
    const st = await lm.ensure('http://127.0.0.1:1234/v1', 'google/gemma-4-12b-qat');
    expect(f.calls).toEqual(expect.arrayContaining(['server start --port 1234', `load google/gemma-4-12b-qat --context-length ${CONFIG.local.contextLength} --parallel 1 -y`]));
    expect(st).toMatchObject({ running: true, spawnedByUs: true });
  });
  it('ensure: carrega com o paralelismo pedido por deps.parallel() (spec paralelismo)', async () => {
    const f = fakes({ running: false });
    const lm = createLmStudio({ exec: f.exec, fetch: f.fetch, lmsPath: f.lmsPath, sleep: async () => {}, parallel: () => 4 });
    await lm.ensure('http://127.0.0.1:1234/v1', 'google/gemma-4-12b-qat');
    expect(f.calls).toContain(`load google/gemma-4-12b-qat --context-length ${CONFIG.local.contextLength} --parallel 4 -y`);
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

describe('contexto do modelo carregado (integrador)', () => {
  it('contexto igual ou maior que o configurado: sem aviso, sem recarregar', async () => {
    const ok = fakes({ loaded: ['llama-3.2-3b-instruct'] });
    const st = await createLmStudio({ exec: ok.exec, fetch: ok.fetch, lmsPath: ok.lmsPath, sleep: async () => {} }).ensure('http://127.0.0.1:1234/v1', 'llama-3.2-3b-instruct');
    expect(st.contextWarning).toBeNull();
    expect(ok.calls.some((c) => c.startsWith('load') || c.startsWith('unload'))).toBe(false);
  });
  it('contexto carregado menor que o configurado: recarrega com lms unload + lms load --context-length e o aviso some', async () => {
    const low = fakes({ loaded: ['llama-3.2-3b-instruct'], ctx: 4096 });
    const st = await createLmStudio({ exec: low.exec, fetch: low.fetch, lmsPath: low.lmsPath, sleep: async () => {} }).ensure('http://127.0.0.1:1234/v1', 'llama-3.2-3b-instruct');
    expect(low.calls).toEqual(expect.arrayContaining(['unload llama-3.2-3b-instruct', `load llama-3.2-3b-instruct --context-length ${CONFIG.local.contextLength} -y`]));
    expect(st.contextWarning).toBeNull();
  });
  it('sem o CLI lms: aviso de contexto desconhecido, sem tentar recarregar', async () => {
    const noCli = fakes({ loaded: ['llama-3.2-3b-instruct'], ctx: 4096 });
    const st = await createLmStudio({ exec: noCli.exec, fetch: noCli.fetch, lmsPath: null, sleep: async () => {} }).ensure('http://127.0.0.1:1234/v1', 'llama-3.2-3b-instruct');
    expect(st.contextWarning).toMatch(/sem o CLI lms/);
    expect(noCli.calls.some((c) => c.startsWith('load') || c.startsWith('unload'))).toBe(false);
  });
});

describe('reloadIfParallelDiffers (spec paralelismo — troca efetiva gerida pelo applyLocalParallel)', () => {
  it('paralelismo real igual ao pedido: não recarrega, devolve o valor atual', async () => {
    const f = fakes({ loaded: ['llama-3.2-3b-instruct'], parallel: 4 });
    const lm = createLmStudio({ exec: f.exec, fetch: f.fetch, lmsPath: f.lmsPath, sleep: async () => {} });
    expect(await lm.reloadIfParallelDiffers('http://127.0.0.1:1234/v1', 4)).toBe(4);
    expect(f.calls.some((c) => c.startsWith('load') || c.startsWith('unload'))).toBe(false);
  });
  it('paralelismo real desconhecido (campo ausente/null): não recarrega, devolve null', async () => {
    const f = fakes({ loaded: ['llama-3.2-3b-instruct'] });
    const lm = createLmStudio({ exec: f.exec, fetch: f.fetch, lmsPath: f.lmsPath, sleep: async () => {} });
    expect(await lm.reloadIfParallelDiffers('http://127.0.0.1:1234/v1', 4)).toBeNull();
    expect(f.calls.some((c) => c.startsWith('load') || c.startsWith('unload'))).toBe(false);
  });
  it('paralelismo real diferente do pedido: recarrega com lms unload + lms load --parallel', async () => {
    const f = fakes({ loaded: ['llama-3.2-3b-instruct'], parallel: 1 });
    const lm = createLmStudio({ exec: f.exec, fetch: f.fetch, lmsPath: f.lmsPath, sleep: async () => {} });
    expect(await lm.reloadIfParallelDiffers('http://127.0.0.1:1234/v1', 4)).toBe(4);
    expect(f.calls).toEqual(expect.arrayContaining(['unload llama-3.2-3b-instruct', `load llama-3.2-3b-instruct --context-length ${CONFIG.local.contextLength} --parallel 4 -y`]));
  });
  it('load falha depois do unload: modelo fica descarregado, loga claro e devolve null (mantém o comportamento)', async () => {
    const f = fakes({ loaded: ['llama-3.2-3b-instruct'], parallel: 1 });
    const failingExec: typeof f.exec = async (file, args, opts) => {
      if (args[0] === 'load') return { stdout: '', stderr: 'falhou de propósito', code: 1 };
      return f.exec(file, args, opts);
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const lm = createLmStudio({ exec: failingExec, fetch: f.fetch, lmsPath: f.lmsPath, sleep: async () => {} });
    expect(await lm.reloadIfParallelDiffers('http://127.0.0.1:1234/v1', 4)).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatch(/llama-3\.2-3b-instruct.*--parallel 4.*falhou/);
    spy.mockRestore();
  });
  it('sem o CLI lms: não recarrega, devolve null', async () => {
    const f = fakes({ loaded: ['llama-3.2-3b-instruct'], parallel: 1 });
    const lm = createLmStudio({ exec: f.exec, fetch: f.fetch, lmsPath: null, sleep: async () => {} });
    expect(await lm.reloadIfParallelDiffers('http://127.0.0.1:1234/v1', 4)).toBeNull();
  });
  it('nada carregado: não recarrega, devolve null', async () => {
    const f = fakes({});
    const lm = createLmStudio({ exec: f.exec, fetch: f.fetch, lmsPath: f.lmsPath, sleep: async () => {} });
    expect(await lm.reloadIfParallelDiffers('http://127.0.0.1:1234/v1', 4)).toBeNull();
  });
});

describe('unload do LM Studio (integrador)', () => {
  it('só descarrega se o modelo estiver carregado', async () => {
    const f = fakes({ loaded: ['llama-3.2-3b-instruct'] });
    const lm = createLmStudio({ exec: f.exec, fetch: f.fetch, lmsPath: f.lmsPath, sleep: async () => {} });
    await lm.unload('http://127.0.0.1:1234/v1', 'google/gemma-4-12b-qat');
    await lm.unload('http://127.0.0.1:1234/v1', 'llama-3.2-3b-instruct');
    expect(f.calls.filter((c) => c.includes('unload'))).toEqual(['rest-unload llama-3.2-3b-instruct']);
  });
});

describe('findLms — CLI do LM Studio por SO', () => {
  const has = (...files: string[]) => (p: string) => files.includes(p);
  it('Linux/macOS: ~/.lmstudio/bin/lms primeiro, depois o PATH', () => {
    expect(findLms({ platform: 'linux', home: '/home/u', pathEnv: '/usr/bin', exists: has('/home/u/.lmstudio/bin/lms', '/usr/bin/lms') })).toBe('/home/u/.lmstudio/bin/lms');
    expect(findLms({ platform: 'darwin', home: '/Users/u', pathEnv: '/usr/bin:/opt/bin', exists: has('/opt/bin/lms') })).toBe('/opt/bin/lms');
    expect(findLms({ platform: 'linux', home: '/home/u', pathEnv: '', exists: has() })).toBeNull();
  });
  it('Windows: lms.exe, PATH separado por ;', () => {
    expect(findLms({ platform: 'win32', home: 'C:\\Users\\u', pathEnv: 'C:\\bin', exists: has('C:\\Users\\u\\.lmstudio\\bin\\lms.exe') }))
      .toBe('C:\\Users\\u\\.lmstudio\\bin\\lms.exe');
    expect(findLms({ platform: 'win32', home: 'C:\\Users\\u', pathEnv: 'C:\\a;D:\\tools', exists: has('D:\\tools\\lms.exe') })).toBe('D:\\tools\\lms.exe');
    expect(findLms({ platform: 'win32', home: 'C:\\Users\\u', pathEnv: 'C:\\a', exists: has('C:\\Users\\u\\.lmstudio\\bin\\lms') })).toBeNull();
  });
});

describe('unload (API REST v1 primeiro, `lms unload` como plano B)', () => {
  const EP = 'http://127.0.0.1:1234/v1';
  /** Servidor com `model` carregado; `rest` = status da rota /api/v1/models/unload (null = rota lança). */
  function server(o: { rest: number | null; lmsCode?: number; loaded?: boolean }) {
    const calls: string[] = []; const posts: { url: string; body: unknown }[] = [];
    const fetch = (async (u: string, init?: { method?: string; body?: string }) => {
      if (init?.method === 'POST') {
        posts.push({ url: u, body: JSON.parse(init.body ?? 'null') });
        if (o.rest === null) throw new Error('ECONNRESET');
        return { ok: o.rest >= 200 && o.rest < 300, status: o.rest, text: async () => 'not found', json: async () => ({}) };
      }
      return { ok: true, json: async () => V0({ 'qwen/qwen3.6-27b': o.loaded === false ? 'not-loaded' : 'loaded' }) };
    }) as never;
    const exec = async (_f: string, args: readonly string[]) => {
      calls.push(args.join(' '));
      return { stdout: '', stderr: o.lmsCode ? 'Invalid passkey for lms CLI client' : '', code: o.lmsCode ?? 0 };
    };
    return { fetch, exec, calls, posts };
  }

  it('descarrega pela API REST (instance_id) sem chamar o CLI', async () => {
    const s = server({ rest: 200 });
    await createLmStudio({ exec: s.exec, fetch: s.fetch, lmsPath: '/x/lms' }).unload(EP, 'qwen/qwen3.6-27b');
    expect(s.posts).toEqual([{ url: 'http://127.0.0.1:1234/api/v1/models/unload', body: { instance_id: 'qwen/qwen3.6-27b' } }]);
    expect(s.calls).toEqual([]);
  });
  it('funciona sem o CLI lms instalado', async () => {
    const s = server({ rest: 200 });
    await createLmStudio({ exec: s.exec, fetch: s.fetch, lmsPath: null }).unload(EP, 'qwen/qwen3.6-27b');
    expect(s.posts).toHaveLength(1);
  });
  it('API sem a rota (LM Studio antigo): cai no `lms unload`', async () => {
    const s = server({ rest: 404 });
    await createLmStudio({ exec: s.exec, fetch: s.fetch, lmsPath: '/x/lms' }).unload(EP, 'qwen/qwen3.6-27b');
    expect(s.calls).toEqual(['unload qwen/qwen3.6-27b']);
  });
  it('API e CLI falham (ex.: passkey do lms): erro com os dois motivos', async () => {
    const s = server({ rest: null, lmsCode: 1 });
    await expect(createLmStudio({ exec: s.exec, fetch: s.fetch, lmsPath: '/x/lms' }).unload(EP, 'qwen/qwen3.6-27b'))
      .rejects.toThrow(/qwen\/qwen3\.6-27b.*ECONNRESET.*Invalid passkey/);
  });
  it('modelo não carregado: nada a fazer', async () => {
    const s = server({ rest: 200, loaded: false });
    await createLmStudio({ exec: s.exec, fetch: s.fetch, lmsPath: '/x/lms' }).unload(EP, 'qwen/qwen3.6-27b');
    expect(s.posts).toEqual([]); expect(s.calls).toEqual([]);
  });
});
