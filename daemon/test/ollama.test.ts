import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../src/config.js';
import { ProviderError } from '../src/provider/errors.js';
import { createOllamaSupervisor, isLoopbackHost, modelListed, OLLAMA_ENV, resetExternalOllamaWarning, warnIfExternalOllama } from '../src/provider/ollama.js';

const tags = (...names: string[]) => new Response(JSON.stringify({ models: names.map((name) => ({ name })) }), { status: 200 });
const refused = () => { throw new Error('fetch failed: ECONNREFUSED'); };

function harness(script: (() => Response)[]) {
  const spawned: { cmd: string; args: readonly string[]; env: NodeJS.ProcessEnv }[] = [];
  const killed: string[] = [];
  const posts: { url: string; body: unknown }[] = [];
  let i = 0;
  const fetchFn = (async (url: unknown, init?: { method?: string; body?: string }) => {
    if (init?.method === 'POST') { posts.push({ url: String(url), body: JSON.parse(init.body ?? '{}') }); return new Response('{}', { status: 200 }); }
    const step = script[Math.min(i, script.length - 1)]; i++; return step();
  }) as unknown as typeof fetch;
  const child = { pid: 4242, kill: (s?: string) => { killed.push(String(s)); return true; }, on: () => undefined };
  const sup = createOllamaSupervisor({
    fetch: fetchFn, sleep: async () => {}, timeoutMs: 20_000, logPath: '/dev/null', openLog: () => 'ignore', findProcesses: () => [],
    spawn: (cmd, args, opts) => { spawned.push({ cmd, args, env: opts.env }); return child; },
  });
  return { sup, spawned, killed, posts };
}

describe('supervisor do Ollama', () => {
  it('OLLAMA_CONTEXT_LENGTH vem de CONFIG.local.contextLength', () => {
    expect(OLLAMA_ENV.OLLAMA_CONTEXT_LENGTH).toBe(String(CONFIG.local.contextLength));
  });
  it('endpoint vivo → não spawna, lista modelos, spawnedByUs=false e stop() não mata', async () => {
    const h = harness([() => tags('qwen3.5:27b')]);
    const st = await h.sup.ensure('http://127.0.0.1:11434/v1', 'qwen3.5:27b');
    expect(st).toEqual({ running: true, spawnedByUs: false, adopted: false, pid: null, models: ['qwen3.5:27b'] });
    expect(h.spawned).toHaveLength(0); h.sup.stop(); expect(h.killed).toEqual([]);
  });
  it('endpoint morto → spawna `ollama serve` com o env exato e espera /api/tags', async () => {
    const h = harness([refused, refused, () => tags('qwen3.5:27b')]);
    const st = await h.sup.ensure('http://127.0.0.1:11434/v1', 'qwen3.5:27b');
    expect(st.spawnedByUs).toBe(true); expect(st.pid).toBe(4242);
    expect(h.spawned[0]).toMatchObject({ cmd: 'ollama', args: ['serve'] });
    expect(h.spawned[0].env).toMatchObject({ ...OLLAMA_ENV, OLLAMA_HOST: '127.0.0.1:11434' });
    h.sup.stop(); expect(h.killed).toEqual(['SIGTERM']);
  });
  it('não sobe dentro do timeout → mata o filho e lança infra-local', async () => {
    const killed: string[] = [];
    const sup = createOllamaSupervisor({ fetch: (async () => refused()) as never, sleep: async () => {}, timeoutMs: 1, logPath: '/dev/null', openLog: () => 'x', spawn: () => ({ pid: 1, kill: (s?: string) => { killed.push(String(s)); return true; }, on: () => undefined }) });
    await expect(sup.ensure('http://127.0.0.1:11434/v1', 'm')).rejects.toSatisfy((e: unknown) => ProviderError.isInstance(e) && e.kind === 'infra-local' && /não subiu/i.test(e.message));
    expect(killed).toContain('SIGTERM');
  });
  it('modelo ausente em /api/tags → infra-local com instrução de pull; nunca faz pull', async () => {
    const h = harness([() => tags('gemma4:12b')]);
    await expect(h.sup.ensure('http://127.0.0.1:11434/v1', 'qwen3.5:27b')).rejects.toSatisfy((e: unknown) => ProviderError.isInstance(e) && e.kind === 'infra-local' && /ollama pull qwen3\.5:27b/.test(e.message));
    expect(h.posts).toEqual([]);
  });
  it('modelListed casa tag :latest nos dois sentidos (Review Focus 5)', () => {
    expect(modelListed(['gemma4:latest'], 'gemma4')).toBe(true);
    expect(modelListed(['gemma4:12b'], 'gemma4')).toBe(false);
    expect(modelListed(['qwen3.5:27b'], 'qwen3.5:27b')).toBe(true);
    expect(modelListed(['llama3.2:latest'], 'llama3.2:latest')).toBe(true);
  });
  it('unload envia keep_alive 0 na API nativa', async () => {
    const h = harness([() => tags('a')]);
    await h.sup.unload('http://127.0.0.1:11434/v1', 'a');
    expect(h.posts[0]).toEqual({ url: 'http://127.0.0.1:11434/api/generate', body: { model: 'a', keep_alive: 0 } });
  });
});

describe('supervisor — revisão final', () => {
  it('Critical 1: spawn com ENOENT → infra-local citando o PATH, sem exceção solta', async () => {
    let onError: ((e: Error) => void) | null = null;
    const sup = createOllamaSupervisor({ fetch: (async () => { throw new Error('ECONNREFUSED'); }) as never, sleep: async () => { onError?.(Object.assign(new Error('spawn ollama ENOENT'), { code: 'ENOENT' })); }, timeoutMs: 20_000, logPath: '/dev/null', openLog: () => 'x', findProcesses: () => [],
      spawn: () => ({ pid: undefined, kill: () => true, on: (ev, cb) => { if (ev === 'error') onError = cb as never; } }) });
    await expect(sup.ensure('http://127.0.0.1:11434/v1', 'm')).rejects.toMatchObject({ kind: 'infra-local', message: expect.stringMatching(/PATH/) });
  });
  it('Important 1: filho morre antes do /api/tags responder (Ollama externo subiu junto) → spawnedByUs=false', async () => {
    let onExit: (() => void) | null = null; let calls = 0;
    const sup = createOllamaSupervisor({ fetch: (async () => { calls++; if (calls < 3) throw new Error('ECONNREFUSED'); return tags('m'); }) as never, sleep: async () => { onExit?.(); }, timeoutMs: 20_000, logPath: '/dev/null', openLog: () => 'x', findProcesses: () => [],
      spawn: () => ({ pid: 7, kill: () => true, on: (ev, cb) => { if (ev === 'exit') onExit = cb as never; } }) });
    const st = await sup.ensure('http://127.0.0.1:11434/v1', 'm');
    expect(st.spawnedByUs).toBe(false); expect(st.pid).toBeNull();
  });
  it('Important 2: Ollama vivo com o env do daemon (órfão de um daemon anterior) é adotado e stop() o mata', async () => {
    const killed: number[] = [];
    const sup = createOllamaSupervisor({ fetch: (async () => tags('m')) as never, findProcesses: () => [{ pid: 999, env: `OLLAMA_HOST=127.0.0.1:11434\0OLLAMA_CONTEXT_LENGTH=${CONFIG.local.contextLength}\0` }], kill: (pid) => { killed.push(pid); } });
    const st = await sup.ensure('http://127.0.0.1:11434/v1', 'm');
    expect(st).toMatchObject({ spawnedByUs: true, adopted: true, pid: 999 });
    sup.stop(); expect(killed).toEqual([999]);
  });
  it('Important 2b: Ollama vivo sem o marcador de env é externo (não adotado, não morto)', async () => {
    const killed: number[] = [];
    const sup = createOllamaSupervisor({ fetch: (async () => tags('m')) as never, findProcesses: () => [{ pid: 5, env: 'OLLAMA_HOST=127.0.0.1:11434\0' }], kill: (pid) => { killed.push(pid); } });
    expect(await sup.ensure('http://127.0.0.1:11434/v1', 'm')).toMatchObject({ spawnedByUs: false, adopted: false, pid: null });
    sup.stop(); expect(killed).toEqual([]);
  });
  it('Important 9: sob vitest, sem spawn injetado, nunca spawna processo real', async () => {
    const sup = createOllamaSupervisor({ fetch: (async () => { throw new Error('ECONNREFUSED'); }) as never, findProcesses: () => [] });
    await expect(sup.ensure('http://127.0.0.1:11434/v1', 'm')).rejects.toMatchObject({ kind: 'infra-local', message: expect.stringMatching(/teste/) });
  });
});

describe('supervisor — incremento 3', () => {
  it('isLoopbackHost', () => {
    for (const h of ['127.0.0.1:11434', 'localhost:11434', '[::1]:11434', '127.0.0.1']) expect(isLoopbackHost(h), h).toBe(true);
    for (const h of ['192.168.1.5:11434', 'ollama.lan:11434', '10.0.0.2']) expect(isLoopbackHost(h), h).toBe(false);
  });
  it('endpoint remoto morto → infra-local sem spawn; remoto vivo → conecta sem adotar (Review Focus 2)', async () => {
    const spawned: string[] = [];
    const dead = createOllamaSupervisor({ fetch: (async () => { throw new Error('ECONNREFUSED'); }) as never, sleep: async () => {}, findProcesses: () => [], spawn: () => { spawned.push('x'); return { pid: 1, kill: () => true, on: () => undefined }; } });
    await expect(dead.ensure('http://192.168.1.5:11434/v1', 'm')).rejects.toMatchObject({ kind: 'infra-local', message: expect.stringMatching(/remoto/) });
    expect(spawned).toEqual([]);
    const alive = createOllamaSupervisor({ fetch: (async () => tags('m')) as never, findProcesses: () => [{ pid: 9, env: `OLLAMA_HOST=127.0.0.1:11434\0OLLAMA_CONTEXT_LENGTH=${CONFIG.local.contextLength}\0` }] });
    expect(await alive.ensure('http://192.168.1.5:11434/v1', 'm')).toMatchObject({ spawnedByUs: false, adopted: false });
  });
  it('endpoint loopback com path extra continua loopback: spawna com OLLAMA_HOST só host:porta e adota o órfão', async () => {
    const endpoint = 'http://127.0.0.1:11434/ollama/v1';
    const h = harness([refused, refused, () => tags('m')]);
    const st = await h.sup.ensure(endpoint, 'm');
    expect(st.spawnedByUs).toBe(true);
    expect(h.spawned[0].env.OLLAMA_HOST).toBe('127.0.0.1:11434');
    const alive = createOllamaSupervisor({ fetch: (async () => tags('m')) as never, findProcesses: () => [{ pid: 7, env: `OLLAMA_HOST=127.0.0.1:11434\0OLLAMA_CONTEXT_LENGTH=${CONFIG.local.contextLength}\0` }], kill: () => {} });
    expect(await alive.ensure(endpoint, 'm')).toMatchObject({ running: true, adopted: true, pid: 7 });
  });
  it('logPath fica em CONFIG.dataDir e o fd é fechado no stop()', async () => {
    const opened: string[] = []; const closed: unknown[] = [];
    const sup = createOllamaSupervisor({ fetch: (async () => { throw new Error('ECONNREFUSED'); }) as never, sleep: async () => {}, timeoutMs: 1, findProcesses: () => [],
      openLog: (p) => { opened.push(p); return 42; }, closeLog: (fd) => { closed.push(fd); }, spawn: () => ({ pid: 1, kill: () => true, on: () => undefined }) });
    await sup.ensure('http://127.0.0.1:11434/v1', 'm').catch(() => undefined);
    expect(opened[0]).toBe(path.join(CONFIG.dataDir, 'ollama.log')); expect(closed).toEqual([42]);
  });
  it('spawn falha de forma síncrona → fd do log é fechado antes de lançar (revisão: fd leak)', async () => {
    const closed: unknown[] = [];
    const sup = createOllamaSupervisor({ fetch: (async () => { throw new Error('ECONNREFUSED'); }) as never, sleep: async () => {}, findProcesses: () => [],
      openLog: () => 77, closeLog: (fd) => { closed.push(fd); }, spawn: () => { throw new Error('spawn ollama ENOENT'); } });
    await expect(sup.ensure('http://127.0.0.1:11434/v1', 'm')).rejects.toMatchObject({ kind: 'infra-local' });
    expect(closed).toEqual([77]);
  });
});

describe('paralelismo local (restartIfParallelDiffers)', () => {
  it('OLLAMA_NUM_PARALLEL do spawn vem de deps.parallel(), não mais fixo em "1"', async () => {
    const spawned: { env: NodeJS.ProcessEnv }[] = [];
    const sup = createOllamaSupervisor({
      fetch: (async () => { throw new Error('ECONNREFUSED'); }) as never, sleep: async () => {}, timeoutMs: 1, logPath: '/dev/null', openLog: () => 'x', findProcesses: () => [],
      parallel: () => 4,
      spawn: (cmd, args, opts) => { spawned.push({ env: opts.env }); return { pid: 4242, kill: () => true, on: () => undefined }; },
    });
    await expect(sup.ensure('http://127.0.0.1:11434/v1', 'm')).rejects.toBeTruthy();
    expect(spawned[0].env.OLLAMA_NUM_PARALLEL).toBe('4');
  });
  it('sem Ollama nosso rodando (child null): não mexe, devolve null', async () => {
    const sup = createOllamaSupervisor({ fetch: (async () => { throw new Error('x'); }) as never, findProcesses: () => [] });
    expect(await sup.restartIfParallelDiffers(4)).toBeNull();
  });
  it('child null mas há um órfão nosso (marcador de contexto) rodando: adota antes de concluir "externo"', async () => {
    const killed: number[] = []; const spawned: { env: NodeJS.ProcessEnv }[] = [];
    let calls = 0;
    const sup = createOllamaSupervisor({
      fetch: (async () => { calls++; return calls < 3 ? refused() : tags('m'); }) as never, sleep: async () => {}, timeoutMs: 20_000, logPath: '/dev/null', openLog: () => 'x',
      findProcesses: () => [{ pid: 321, env: `OLLAMA_HOST=127.0.0.1:11434\0OLLAMA_CONTEXT_LENGTH=${CONFIG.local.contextLength}\0OLLAMA_NUM_PARALLEL=1\0` }],
      kill: (pid) => killed.push(pid),
      spawn: (cmd, args, opts) => { spawned.push({ env: opts.env }); return { pid: 999, kill: () => true, on: () => undefined }; },
    });
    // Nenhum ensure() rodou nesta subida (child ainda null) — mesmo assim adota o órfão e troca o paralelismo.
    const applied = await sup.restartIfParallelDiffers(4);
    expect(applied).toBe(4);
    expect(killed).toEqual([321]); // matou o órfão adotado via killFn (pid do /proc), não um child.kill próprio
    expect(spawned[0]?.env.OLLAMA_HOST).toBe('127.0.0.1:11434');
    expect(spawned[0]?.env.OLLAMA_NUM_PARALLEL).toBe('4');
  });
  it('valor real do processo desconhecido (não achado no /proc): não mexe, devolve null', async () => {
    const h = harness([refused, refused, () => tags('m')]);
    await h.sup.ensure('http://127.0.0.1:11434/v1', 'm'); // findProcesses: () => [] no harness → desconhecido
    expect(await h.sup.restartIfParallelDiffers(4)).toBeNull();
    expect(h.killed).toEqual([]);
  });
  it('valor real igual ao pedido: não mata, devolve o valor atual', async () => {
    const killed: string[] = [];
    const child = { pid: 4242, kill: (s?: string) => { killed.push(String(s)); return true; }, on: () => undefined };
    let calls = 0;
    const sup = createOllamaSupervisor({
      fetch: (async () => { calls++; return calls < 3 ? refused() : tags('m'); }) as never, sleep: async () => {}, timeoutMs: 20_000, logPath: '/dev/null', openLog: () => 'x',
      findProcesses: () => [{ pid: 4242, env: 'OLLAMA_NUM_PARALLEL=4\0' }], spawn: () => child,
    });
    await sup.ensure('http://127.0.0.1:11434/v1', 'm');
    expect(await sup.restartIfParallelDiffers(4)).toBe(4);
    expect(killed).toEqual([]);
  });
  it('valor real diferente do pedido: mata e sobe de novo com o novo valor no env', async () => {
    const killed: string[] = []; const spawned: { env: NodeJS.ProcessEnv }[] = [];
    const child1 = { pid: 4242, kill: (s?: string) => { killed.push(String(s)); return true; }, on: () => undefined };
    const child2 = { pid: 5555, kill: (s?: string) => { killed.push(String(s)); return true; }, on: () => undefined };
    let calls = 0;
    const sup = createOllamaSupervisor({
      fetch: (async () => { calls++; return calls < 3 ? refused() : tags('m'); }) as never, sleep: async () => {}, timeoutMs: 20_000, logPath: '/dev/null', openLog: () => 'x',
      findProcesses: () => [{ pid: 4242, env: 'OLLAMA_NUM_PARALLEL=1\0' }],
      spawn: (cmd, args, opts) => { const c = spawned.length === 0 ? child1 : child2; spawned.push({ env: opts.env }); return c; },
    });
    await sup.ensure('http://127.0.0.1:11434/v1', 'm');
    const applied = await sup.restartIfParallelDiffers(4);
    expect(applied).toBe(4);
    expect(killed).toContain('SIGTERM');
    expect(spawned.at(-1)?.env.OLLAMA_NUM_PARALLEL).toBe('4');
  });
});

describe('warnIfExternalOllama', () => {
  it('avisa uma vez (spawnedByUs=false); nosso e o segundo aviso não repetem; LM Studio (contextWarning presente) é ignorado', () => {
    resetExternalOllamaWarning();
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warnIfExternalOllama({ spawnedByUs: false });
    warnIfExternalOllama({ spawnedByUs: false });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain(`ENXAME_LOCAL_CONTEXT=${CONFIG.local.contextLength}`);
    spy.mockClear();
    resetExternalOllamaWarning();
    warnIfExternalOllama({ spawnedByUs: true });
    warnIfExternalOllama({ spawnedByUs: false, contextWarning: null });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
