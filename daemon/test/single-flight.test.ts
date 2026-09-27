import { describe, expect, it } from 'vitest';
import type { OllamaStatus, OllamaSupervisor } from '../src/provider/ollama.js';
import { createRuntimeLock } from '../src/swarm/runtime-lock.js';
import { singleFlightOllama } from '../src/swarm/single-flight.js';

const ST: OllamaStatus = { running: true, spawnedByUs: true, adopted: false, pid: 1, models: ['m'] };
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('singleFlightOllama', () => {
  it('ensures concorrentes compartilham uma chamada; depois de resolvida, a próxima chama de novo', async () => {
    let calls = 0; let release!: () => void;
    const sup: OllamaSupervisor = {
      ensure: () => { calls++; return new Promise<OllamaStatus>((r) => { release = () => r(ST); }); },
      unload: async () => {}, stop: () => {}, status: () => null, restartIfParallelDiffers: async () => null,
    };
    const s = singleFlightOllama(sup, createRuntimeLock());
    const a = s.ensure('e', 'm'); const b = s.ensure('e', 'm');
    await wait(1); // a chamada de fato roda dentro da trava — um tick depois, não mais síncrona
    expect(calls).toBe(1);
    release(); expect(await a).toBe(ST); expect(await b).toBe(ST);
    const c = s.ensure('e', 'm'); await wait(1); expect(calls).toBe(2); release(); await c;
  });
  it('erro também libera a próxima tentativa', async () => {
    let calls = 0;
    const s = singleFlightOllama({
      ensure: async () => { calls++; throw new Error('parado'); }, unload: async () => {}, stop: () => {}, status: () => null,
      restartIfParallelDiffers: async () => null,
    }, createRuntimeLock());
    await expect(s.ensure('e', 'm')).rejects.toThrow('parado');
    await expect(s.ensure('e', 'm')).rejects.toThrow('parado');
    expect(calls).toBe(2);
  });
  it('ensure() espera a trava: enquanto outra coisa segura o lock, o ensure não roda até ela soltar', async () => {
    const lock = createRuntimeLock();
    const events: string[] = [];
    const holdLock = lock.run(async () => { events.push('lock-start'); await wait(20); events.push('lock-end'); });
    let ensureCalls = 0;
    const s = singleFlightOllama({
      ensure: async () => { ensureCalls++; events.push('ensure-run'); return ST; },
      unload: async () => {}, stop: () => {}, status: () => null, restartIfParallelDiffers: async () => null,
    }, lock);
    const ensured = s.ensure('e', 'm');
    await wait(1); // dá tempo do lock.run acima já estar segurando a trava
    expect(ensureCalls).toBe(0); // ainda não rodou: a trava está ocupada
    await holdLock;
    expect(await ensured).toBe(ST);
    expect(events).toEqual(['lock-start', 'lock-end', 'ensure-run']);
  });
  it('unload() também espera a trava: não corre junto com um restart/reload em andamento', async () => {
    const lock = createRuntimeLock();
    const events: string[] = [];
    const holdLock = lock.run(async () => { events.push('lock-start'); await wait(20); events.push('lock-end'); });
    let unloadCalls = 0;
    const s = singleFlightOllama({
      ensure: async () => ST,
      unload: async (endpoint, model, runtime) => { unloadCalls++; events.push(`unload-run:${endpoint}:${model}:${runtime ?? ''}`); },
      stop: () => {}, status: () => null, restartIfParallelDiffers: async () => null,
    }, lock);
    const unloaded = s.unload('http://127.0.0.1:11434/v1', 'm', 'ollama');
    await wait(1); // dá tempo do lock.run acima já estar segurando a trava
    expect(unloadCalls).toBe(0); // ainda não rodou: a trava está ocupada pelo restart/reload
    await holdLock;
    await unloaded;
    expect(events).toEqual(['lock-start', 'lock-end', 'unload-run:http://127.0.0.1:11434/v1:m:ollama']);
  });
});
