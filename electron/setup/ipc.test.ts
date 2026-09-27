import { describe, expect, it } from 'vitest';
import { registerSetupIpc, type SetupIpcDeps } from './ipc';
import { resolveSetupPaths } from './paths';
import type { JobRunners } from './runners';

const KEY = 'sk-ant-' + 'x'.repeat(30);
const report = { deps: [], hardware: { ramGiB: 1, threads: 1, cpuModel: 'x', gpu: null, diskFreeGiB: 1 }, localModels: [] };

function mk(over: Partial<SetupIpcDeps> = {}) {
  const handlers = new Map<string, (...a: unknown[]) => unknown>();
  const sent: [string, unknown][] = [];
  const finished: [unknown, string | null][] = [];
  const noop = async () => {};
  const runners: JobRunners = { sdk: noop, adb: noop, emu: noop, img: noop, ollama: noop, model: async (p) => p(5, 10) };
  const deps: SetupIpcDeps = {
    handle: (ch, fn) => handlers.set(ch, fn),
    send: (ch, d) => sent.push([ch, d]),
    paths: resolveSetupPaths({}, '/home/u'),
    status: async () => ({ completed: false, supported: true }),
    probe: async () => ({ report, ollamaBin: 'ollama' }),
    runners: () => runners,
    testKey: async () => ({ result: 'ok' }),
    finish: async (req, bin) => { finished.push([req, bin]); },
    ...over,
  };
  registerSetupIpc(deps);
  const call = (ch: string, ...args: unknown[]) => handlers.get(ch)!({}, ...args);
  return { call, sent, finished };
}

describe('registerSetupIpc', () => {
  it('check devolve só o relatório; finish recebe o ollamaBin achado na verificação', async () => {
    const { call, finished } = mk();
    expect(await call('enxame:setup:check')).toEqual(report);
    await call('enxame:setup:finish', { mode: 'misto', localModel: 'gpt-oss:20b', anthropicKey: KEY });
    expect(finished).toEqual([[{ mode: 'misto', localModel: 'gpt-oss:20b', anthropicKey: KEY }, 'ollama']]);
  });
  it('install valida o pedido, manda eventos e, com o Ollama instalado pelo Enxame, finish usa o binário dele', async () => {
    const { call, sent, finished } = mk();
    await call('enxame:setup:install', { jobs: ['ollama', 'model'], localModel: 'gpt-oss:20b' });
    expect(sent.filter(([ch]) => ch === 'enxame:setup:job').map(([, e]) => (e as { id: string; state: string }).state)).toContain('done');
    await call('enxame:setup:finish', { mode: 'local', localModel: 'gpt-oss:20b', anthropicKey: null });
    expect(finished[0][1]).toBe('/home/u/.local/share/enxame/tools/ollama/bin/ollama');
  });
  it('recusa pedido inválido e instalação em dobro', async () => {
    let release: () => void = () => {};
    const slow: JobRunners = { sdk: async () => {}, adb: async () => {}, emu: async () => {}, img: () => new Promise<void>((r) => { release = r; }), ollama: async () => {}, model: async () => {} };
    const { call } = mk({ runners: () => slow });
    await expect(call('enxame:setup:install', { jobs: ['rm'], localModel: 'x' })).rejects.toThrow();
    const first = call('enxame:setup:install', { jobs: ['img'], localModel: 'gpt-oss:20b' }) as Promise<void>;
    await expect(call('enxame:setup:install', { jobs: ['img'], localModel: 'gpt-oss:20b' })).rejects.toThrow(/em andamento/);
    release();
    await first;
  });
  it('testKey valida a chave antes de sair para a rede', async () => {
    const { call } = mk();
    await expect(call('enxame:setup:testKey', 'abc')).rejects.toThrow();
    expect(await call('enxame:setup:testKey', KEY)).toEqual({ result: 'ok' });
  });
});
