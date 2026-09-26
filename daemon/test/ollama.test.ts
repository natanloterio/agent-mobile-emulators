import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config.js';
import { ProviderError } from '../src/provider/errors.js';
import { createOllamaSupervisor, isLoopbackHost, modelListed, OLLAMA_ENV } from '../src/provider/ollama.js';

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
    const sup = createOllamaSupervisor({ fetch: (async () => tags('m')) as never, findProcesses: () => [{ pid: 999, env: 'OLLAMA_HOST=127.0.0.1:11434\0OLLAMA_CONTEXT_LENGTH=32768\0' }], kill: (pid) => { killed.push(pid); } });
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
    const alive = createOllamaSupervisor({ fetch: (async () => tags('m')) as never, findProcesses: () => [{ pid: 9, env: 'OLLAMA_HOST=127.0.0.1:11434\0OLLAMA_CONTEXT_LENGTH=32768\0' }] });
    expect(await alive.ensure('http://192.168.1.5:11434/v1', 'm')).toMatchObject({ spawnedByUs: false, adopted: false });
  });
  it('logPath fica em CONFIG.dataDir e o fd é fechado no stop()', async () => {
    const opened: string[] = []; const closed: unknown[] = [];
    const sup = createOllamaSupervisor({ fetch: (async () => { throw new Error('ECONNREFUSED'); }) as never, sleep: async () => {}, timeoutMs: 1, findProcesses: () => [],
      openLog: (p) => { opened.push(p); return 42; }, closeLog: (fd) => { closed.push(fd); }, spawn: () => ({ pid: 1, kill: () => true, on: () => undefined }) });
    await sup.ensure('http://127.0.0.1:11434/v1', 'm').catch(() => undefined);
    expect(opened[0]).toBe(path.join(CONFIG.dataDir, 'ollama.log')); expect(closed).toEqual([42]);
  });
});
