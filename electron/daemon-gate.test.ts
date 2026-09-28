import { describe, expect, it } from 'vitest';
import { createDaemonGate } from './daemon-gate';

describe('createDaemonGate', () => {
  it('antes do daemon: erro legível; depois: repassa as informações', async () => {
    const g = createDaemonGate<{ port: number }>();
    await expect(g.use(async () => 1)).rejects.toThrow(/daemon não conectado ainda/);
    g.fail('daemon não respondeu em 15 s');
    await expect(g.use(async () => 1)).rejects.toThrow(/daemon não conectado: daemon não respondeu em 15 s/);
    g.set({ port: 47800 });
    await expect(g.use(async (i) => i.port)).resolves.toBe(47800);
  });
  it('daemon que caiu depois de pronto: fail esquece a porta velha (erro legível em vez de ECONNREFUSED)', async () => {
    const g = createDaemonGate<{ port: number }>();
    g.set({ port: 47800 });
    g.fail('o daemon parou');
    await expect(g.use(async (i) => i.port)).rejects.toThrow(/daemon não conectado: o daemon parou/);
  });
});
