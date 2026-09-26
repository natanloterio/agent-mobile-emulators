import { describe, expect, it } from 'vitest';
import type { OllamaStatus, OllamaSupervisor } from '../src/provider/ollama.js';
import { singleFlightOllama } from '../src/swarm/single-flight.js';

const ST: OllamaStatus = { running: true, spawnedByUs: true, adopted: false, pid: 1, models: ['m'] };

describe('singleFlightOllama', () => {
  it('ensures concorrentes compartilham uma chamada; depois de resolvida, a próxima chama de novo', async () => {
    let calls = 0; let release!: () => void;
    const sup: OllamaSupervisor = {
      ensure: () => { calls++; return new Promise<OllamaStatus>((r) => { release = () => r(ST); }); },
      unload: async () => {}, stop: () => {}, status: () => null,
    };
    const s = singleFlightOllama(sup);
    const a = s.ensure('e', 'm'); const b = s.ensure('e', 'm');
    expect(calls).toBe(1);
    release(); expect(await a).toBe(ST); expect(await b).toBe(ST);
    const c = s.ensure('e', 'm'); expect(calls).toBe(2); release(); await c;
  });
  it('erro também libera a próxima tentativa', async () => {
    let calls = 0;
    const s = singleFlightOllama({ ensure: async () => { calls++; throw new Error('parado'); }, unload: async () => {}, stop: () => {}, status: () => null });
    await expect(s.ensure('e', 'm')).rejects.toThrow('parado');
    await expect(s.ensure('e', 'm')).rejects.toThrow('parado');
    expect(calls).toBe(2);
  });
});
