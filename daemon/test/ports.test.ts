import net from 'node:net';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { upsertIdentity } from '../src/db/identities.js';
import { isPortFree, leasePorts } from '../src/fleet/ports.js';

const hold = (port: number) => new Promise<net.Server>((r) => { const s = net.createServer(); s.listen(port, '127.0.0.1', () => r(s)); });

describe('lease de portas', () => {
  it('detecta porta ocupada no SO', async () => {
    const s = await hold(0); const port = (s.address() as net.AddressInfo).port;
    expect(await isPortFree(port)).toBe(false);
    s.close();
  });
  // Faixa alta de propósito: 5554+ e 8080+ são as portas reais dos emuladores desta máquina, que podem estar em uso.
  it('pula porta presa e porta já leased no banco', async () => {
    const db = openDb(':memory:');
    upsertIdentity(db, { id: 'a', name: 'a', handle: '@a', avdName: 'x', serial: 'emulator-45554', consolePort: 45554, mcpHostPort: 48080, mcpToken: 't', deviceSlug: 'a', appPackage: 'p', appVersionName: '1', state: 'idle' });
    const s = await hold(45556);
    const lease = await leasePorts(db, { consoleFrom: 45554, consoleMax: 45584, mcpHostFrom: 48080 });
    expect(lease.consolePort).toBe(45558);
    expect(lease.mcpHostPort).toBe(48081);
    s.close();
  });
  it('estoura o teto de 16 slots com erro explícito', async () => {
    const db = openDb(':memory:');
    for (let i = 0; i < 16; i++) upsertIdentity(db, { id: `i${i}`, name: `i${i}`, handle: '@', avdName: 'x', serial: `emulator-${45554 + i * 2}`, consolePort: 45554 + i * 2, mcpHostPort: 48080 + i, mcpToken: 't', deviceSlug: `i${i}`, appPackage: 'p', appVersionName: '1', state: 'idle' });
    await expect(leasePorts(db, { consoleFrom: 45554, consoleMax: 45584, mcpHostFrom: 48080 })).rejects.toThrow(/16 slots/);
  });
});
