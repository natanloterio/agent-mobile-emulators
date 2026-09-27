import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { ndjsonLines, pullModel, pullProgress, type PullDeps } from './ollama-pull.js';

const stream = (chunks: string[]) => new ReadableStream<Uint8Array>({
  start(c) { for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch)); c.close(); },
});

function deps(o: { alive: boolean[]; pull: () => Response }): PullDeps & { spawned: string[]; logs: string[]; killedCount: () => number } {
  const spawned: string[] = []; const logs: string[] = []; let killed = 0; let i = 0;
  return {
    fetch: (async (url: unknown) => {
      if (String(url).endsWith('/api/version')) { const up = o.alive[Math.min(i, o.alive.length - 1)]; i++; if (!up) throw new TypeError('fetch failed'); return new Response('{"version":"0.34.4"}'); }
      return o.pull();
    }) as unknown as typeof fetch,
    spawn: (cmd: string) => { spawned.push(cmd); const ev = new EventEmitter(); return Object.assign(ev, { kill: () => { killed++; return true; } }) as unknown as ChildProcess; },
    sleep: async () => {},
    log: (l: string) => logs.push(l),
    spawned, logs, killedCount: () => killed,
  };
}

describe('ndjsonLines', () => {
  it('junta linhas quebradas entre pedaços', async () => {
    const out: string[] = [];
    for await (const l of ndjsonLines(stream(['{"a":', '1}\n{"b":2}\n', '{"c":3}']))) out.push(l);
    expect(out).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });
});

describe('pullProgress', () => {
  it('soma as camadas', () => {
    expect(pullProgress(new Map([['a', { total: 100, completed: 50 }], ['b', { total: 10, completed: 10 }]]))).toEqual({ done: 60, total: 110 });
  });
});

describe('pullModel', () => {
  const lines = [
    '{"status":"pulling manifest"}',
    '{"status":"pulling e7b2","digest":"sha256:e7b2","total":13000000000,"completed":0}',
    '{"status":"pulling e7b2","digest":"sha256:e7b2","total":13000000000,"completed":6500000000}',
    '{"status":"success"}',
  ].join('\n');

  it('com Ollama no ar: não spawna, reporta MB e loga os status', async () => {
    const d = deps({ alive: [true], pull: () => new Response(stream([lines])) });
    const seen: [number, number][] = [];
    await pullModel('gpt-oss:20b', '/bin/ollama', d, (done, total) => seen.push([done, total]));
    expect(d.spawned).toEqual([]);
    expect(seen.at(-1)).toEqual([6500, 13000]);
    expect(d.logs).toContain('pulling manifest');
  });
  it('sem Ollama: sobe `serve` temporário, espera responder e derruba no fim', async () => {
    const d = deps({ alive: [false, false, true], pull: () => new Response(stream([lines])) });
    await pullModel('gpt-oss:20b', '/opt/ollama/bin/ollama', d, () => {});
    expect(d.spawned).toEqual(['/opt/ollama/bin/ollama']);
    expect(d.killedCount()).toBe(1);
  });
  it('erro de disco cheio no meio do pull vira disk-full e ainda derruba o serve', async () => {
    const d = deps({ alive: [false, true], pull: () => new Response(stream([
      '{"status":"pulling e7b2","digest":"sha256:e7b2","total":100,"completed":61}\n',
      '{"error":"write /home/u/.ollama/models/blobs/sha256-e7b2-partial: no space left on device"}\n',
    ])) });
    await expect(pullModel('gpt-oss:20b', 'ollama', d, () => {})).rejects.toMatchObject({ kind: 'disk-full' });
    expect(d.killedCount()).toBe(1);
  });
  it('modelo inexistente vira process com a mensagem do Ollama', async () => {
    const d = deps({ alive: [true], pull: () => new Response(stream(['{"error":"pull model manifest: file does not exist"}\n'])) });
    await expect(pullModel('naoexiste:1b', 'ollama', d, () => {})).rejects.toMatchObject({ kind: 'process', message: expect.stringContaining('file does not exist') });
  });
});
