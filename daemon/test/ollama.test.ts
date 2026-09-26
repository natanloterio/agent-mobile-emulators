import { describe, expect, it } from 'vitest';
import { ProviderError } from '../src/provider/errors.js';
import { createOllamaSupervisor, modelListed, OLLAMA_ENV } from '../src/provider/ollama.js';

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
    fetch: fetchFn, sleep: async () => {}, timeoutMs: 20_000, logPath: '/dev/null', openLog: () => 'ignore',
    spawn: (cmd, args, opts) => { spawned.push({ cmd, args, env: opts.env }); return child; },
  });
  return { sup, spawned, killed, posts };
}

describe('supervisor do Ollama', () => {
  it('endpoint vivo → não spawna, lista modelos, spawnedByUs=false e stop() não mata', async () => {
    const h = harness([() => tags('qwen3.5:27b')]);
    const st = await h.sup.ensure('http://127.0.0.1:11434/v1', 'qwen3.5:27b');
    expect(st).toEqual({ running: true, spawnedByUs: false, pid: null, models: ['qwen3.5:27b'] });
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
