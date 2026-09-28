import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { listenLoopback } from '../src/server/listen.js';

const open: Server[] = [];
const server = () => { const s = createServer(); open.push(s); return s; };
afterEach(async () => { await Promise.all(open.splice(0).map((s) => new Promise<void>((r) => (s.listening ? s.close(() => r()) : r())))); });

describe('listenLoopback', () => {
  it('porta padrão livre: usa ela', async () => {
    const probe = server(); await listenLoopback(probe, { port: 0 });
    const free = (probe.address() as { port: number }).port; await new Promise<void>((r) => probe.close(() => r()));
    expect(await listenLoopback(server(), { defaultPort: free })).toBe(free);
  });
  it('porta padrão ocupada (ex.: daemon de outra versão): cai numa porta livre em vez de derrubar o daemon', async () => {
    const busy = server(); const taken = await listenLoopback(busy, { port: 0 });
    const port = await listenLoopback(server(), { defaultPort: taken });
    expect(port).not.toBe(taken);
    expect(port).toBeGreaterThan(0);
  });
  it('porta pedida explicitamente (TAPFLOCK_PORT) ocupada: falha, sem trocar de porta calado', async () => {
    const busy = server(); const taken = await listenLoopback(busy, { port: 0 });
    await expect(listenLoopback(server(), { port: taken })).rejects.toThrow(/EADDRINUSE/);
  });
});
