import { describe, expect, it } from 'vitest';
import { classifyGpu, parseComputeApps } from '../src/host/gpu.js';

const APPS = `18089, /usr/libexec/gnome-remote-desktop-daemon, 504 MiB
2893986, /home/u/Android/Sdk/emulator/qemu/linux-x86_64/qemu-system-x86_64, 551 MiB
465257, /home/u/Android/Sdk/emulator/qemu/linux-x86_64/qemu-system-x86_64, 664 MiB
467689, /usr/local/lib/ollama/llama-server, 13664 MiB
471324, /usr/local/lib/ollama/llama-server, 9430 MiB
504815, /home/u/.lmstudio/.internal/utils/node, 3642 MiB`;
const CMD: Record<number, string> = {
  467689: '/usr/local/lib/ollama/llama-server --model /home/u/.ollama/models/blobs/sha256-aaa --port 1',
  471324: '/usr/local/lib/ollama/llama-server --model /home/u/.ollama/models/blobs/sha256-bbb --port 2',
  504815: '/home/u/.lmstudio/.internal/utils/node -e ... require("/home/u/.lmstudio/llmster/0.0.12-1/.bundle/lib/llmworker.js")',
};

describe('parseComputeApps', () => {
  it('lê pid, nome e MiB; linhas quebradas somem', () => {
    expect(parseComputeApps(APPS + '\nlixo')).toHaveLength(6);
    expect(parseComputeApps(APPS)[3]).toEqual({ pid: 467689, name: '/usr/local/lib/ollama/llama-server', usedMiB: 13664 });
  });
});

describe('classifyGpu', () => {
  const deps = { cmdline: (pid: number) => CMD[pid] ?? null, ollamaBlobs: () => new Map([['sha256-aaa', 'gpt-oss:20b'], ['sha256-bbb', 'gemma4:12b-instruct']]), lmsLoaded: async () => ['llama-3.2-3b-instruct'] };
  it('um modelo por processo, emuladores somados e o resto como "outros"', async () => {
    const g = await classifyGpu(parseComputeApps(APPS), { usedMiB: 30000, totalMiB: 32607 }, deps);
    expect(g.slices).toEqual([
      { kind: 'model', label: 'gpt-oss:20b · Ollama', usedMiB: 13664, runtime: 'ollama' },
      { kind: 'model', label: 'gemma4:12b-instruct · Ollama', usedMiB: 9430, runtime: 'ollama' },
      { kind: 'model', label: 'llama-3.2-3b-instruct · LM Studio', usedMiB: 3642, runtime: 'lmstudio' },
      { kind: 'emulators', label: 'emulators', usedMiB: 1215 },
      { kind: 'other', label: 'other', usedMiB: 30000 - 13664 - 9430 - 3642 - 1215 },
    ]);
    expect(g).toMatchObject({ usedMiB: 30000, totalMiB: 32607 });
  });
  it('blob desconhecido e vários modelos no LM Studio não quebram: rótulo genérico / nomes juntos', async () => {
    const g = await classifyGpu(parseComputeApps(APPS), { usedMiB: 30000, totalMiB: 32607 }, { ...deps, ollamaBlobs: () => new Map(), lmsLoaded: async () => ['a', 'b'] });
    expect(g.slices.filter((s) => s.kind === 'model').map((s) => s.label)).toEqual(['Ollama (modelo desconhecido)', 'Ollama (modelo desconhecido)', 'a, b · LM Studio']);
  });
  it('"outros" nunca fica negativo', async () => {
    const g = await classifyGpu(parseComputeApps(APPS), { usedMiB: 1000, totalMiB: 32607 }, deps);
    expect(g.slices.find((s) => s.kind === 'other')).toBeUndefined();
  });
});
