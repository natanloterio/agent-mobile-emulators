import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { writeLocalParallel } from '../src/db/settings.js';
import { createLocalParallelController } from '../src/provider/local-parallel.js';
import { createRuntimeLock } from '../src/swarm/runtime-lock.js';
import { singleFlightOllama } from '../src/swarm/single-flight.js';
import type { OllamaStatus, OllamaSupervisor } from '../src/provider/ollama.js';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function mk(o: { idle?: boolean; ollama?: (w: number) => Promise<number | null>; lmstudio?: (e: string, w: number) => Promise<number | null> } = {}) {
  const db = openDb(':memory:');
  const ollamaCalls: number[] = []; const lmstudioCalls: { endpoint: string; wanted: number }[] = [];
  const ctl = createLocalParallelController({
    db,
    isIdle: () => o.idle ?? true,
    lmstudioEndpoint: 'http://127.0.0.1:1234/v1',
    lock: createRuntimeLock(),
    ollama: { restartIfParallelDiffers: async (w) => { ollamaCalls.push(w); return o.ollama ? o.ollama(w) : w; } },
    lmstudio: { reloadIfParallelDiffers: async (e, w) => { lmstudioCalls.push({ endpoint: e, wanted: w }); return o.lmstudio ? o.lmstudio(e, w) : w; } },
  });
  return { db, ctl, ollamaCalls, lmstudioCalls };
}

describe('createLocalParallelController', () => {
  it('estado inicial: wanted do banco (default 1), nada aplicado ainda, não pendente', () => {
    const { ctl } = mk();
    expect(ctl.status()).toEqual({ wanted: 1, applied: { ollama: null, lmstudio: null }, pending: false });
  });
  it('apply() com a frota ociosa: chama os dois runtimes e reflete o aplicado no status', async () => {
    const { db, ctl, ollamaCalls, lmstudioCalls } = mk({ idle: true });
    writeLocalParallel(db, 4);
    await ctl.apply();
    expect(ollamaCalls).toEqual([4]);
    expect(lmstudioCalls).toEqual([{ endpoint: 'http://127.0.0.1:1234/v1', wanted: 4 }]);
    expect(ctl.status()).toEqual({ wanted: 4, applied: { ollama: 4, lmstudio: 4 }, pending: false });
  });
  it('apply() com a frota ocupada: não mexe nos runtimes, marca pendente', async () => {
    const { db, ctl, ollamaCalls, lmstudioCalls } = mk({ idle: false });
    writeLocalParallel(db, 3);
    await ctl.apply();
    expect(ollamaCalls).toEqual([]);
    expect(lmstudioCalls).toEqual([]);
    expect(ctl.status()).toEqual({ wanted: 3, applied: { ollama: null, lmstudio: null }, pending: true });
  });
  it('pendente e depois ociosa: a próxima apply() aplica e desfaz o pendente', async () => {
    const db = openDb(':memory:');
    let idle = false;
    const ctl = createLocalParallelController({
      db, isIdle: () => idle, lmstudioEndpoint: 'http://127.0.0.1:1234/v1', lock: createRuntimeLock(),
      ollama: { restartIfParallelDiffers: async (w) => w }, lmstudio: { reloadIfParallelDiffers: async (_e, w) => w },
    });
    writeLocalParallel(db, 5);
    await ctl.apply();
    expect(ctl.status().pending).toBe(true);
    idle = true;
    await ctl.apply();
    expect(ctl.status()).toEqual({ wanted: 5, applied: { ollama: 5, lmstudio: 5 }, pending: false });
  });
  it('runtime externo/desconhecido (aplicado null): status reflete null sem quebrar', async () => {
    const { ctl } = mk({ idle: true, ollama: async () => null, lmstudio: async () => null });
    await ctl.apply();
    expect(ctl.status().applied).toEqual({ ollama: null, lmstudio: null });
    expect(ctl.status().pending).toBe(false);
  });
  it('erro num dos runtimes não quebra o apply do outro; vira null', async () => {
    const { ctl } = mk({ idle: true, ollama: async () => { throw new Error('boom'); } });
    await ctl.apply();
    expect(ctl.status().applied.ollama).toBeNull();
    expect(ctl.status().applied.lmstudio).toBe(1);
  });
});

describe('createLocalParallelController — corrida com ensure() (revisão: trava compartilhada)', () => {
  it('duas apply() concorrentes colapsam: só um restart roda, a outra só fica pendente', async () => {
    const db = openDb(':memory:');
    let ollamaCalls = 0;
    const ctl = createLocalParallelController({
      db, isIdle: () => true, lmstudioEndpoint: 'http://127.0.0.1:1234/v1', lock: createRuntimeLock(),
      ollama: { restartIfParallelDiffers: async (w) => { ollamaCalls++; await wait(15); return w; } },
      lmstudio: { reloadIfParallelDiffers: async (_e, w) => w },
    });
    writeLocalParallel(db, 4);
    const a = ctl.apply(); const b = ctl.apply(); // sobrepostas, sem esperar a primeira
    await Promise.all([a, b]);
    expect(ollamaCalls).toBe(1);
    expect(ctl.status()).toEqual({ wanted: 4, applied: { ollama: 4, lmstudio: 4 }, pending: false });
  });
  it('tarefa vira "running" entre a checagem de fora e a de dentro da trava: não restarta, fica pendente', async () => {
    const db = openDb(':memory:');
    let idleCalls = 0;
    let ollamaCalls = 0;
    const ctl = createLocalParallelController({
      db,
      // 1ª chamada (checagem barata, fora da trava): ociosa. 2ª chamada (checagem de novo, já dentro da trava): ocupada —
      // simula uma tarefa que começou a rodar bem nesse intervalo.
      isIdle: () => { idleCalls++; return idleCalls === 1; },
      lmstudioEndpoint: 'http://127.0.0.1:1234/v1', lock: createRuntimeLock(),
      ollama: { restartIfParallelDiffers: async (w) => { ollamaCalls++; return w; } },
      lmstudio: { reloadIfParallelDiffers: async (_e, w) => w },
    });
    writeLocalParallel(db, 4);
    await ctl.apply();
    expect(ollamaCalls).toBe(0);
    expect(ctl.status().pending).toBe(true);
  });
  it('ensure() (via singleFlightOllama, mesma trava) espera o apply() em restart terminar antes de rodar', async () => {
    const db = openDb(':memory:');
    const lock = createRuntimeLock();
    const events: string[] = [];
    const ctl = createLocalParallelController({
      db, isIdle: () => true, lmstudioEndpoint: 'http://127.0.0.1:1234/v1', lock,
      ollama: { restartIfParallelDiffers: async (w) => { events.push('restart-start'); await wait(20); events.push('restart-end'); return w; } },
      lmstudio: { reloadIfParallelDiffers: async (_e, w) => w },
    });
    writeLocalParallel(db, 4);
    const fakeSup: OllamaSupervisor = {
      ensure: async () => { events.push('ensure-run'); return { running: true, spawnedByUs: true, adopted: false, pid: 1, models: ['m'] } as OllamaStatus; },
      unload: async () => {}, stop: () => {}, status: () => null, restartIfParallelDiffers: async () => null,
    };
    const ollamaWithSingleFlight = singleFlightOllama(fakeSup, lock);
    const applyDone = ctl.apply();
    await wait(1); // dá tempo do apply já estar segurando a trava, em pleno "restart"
    const ensureDone = ollamaWithSingleFlight.ensure('http://127.0.0.1:11434/v1', 'm');
    await Promise.all([applyDone, ensureDone]);
    expect(events).toEqual(['restart-start', 'restart-end', 'ensure-run']);
  });
});
