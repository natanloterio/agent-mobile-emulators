import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { getIdentity, setIdentityFlags, upsertIdentity } from '../src/db/identities.js';
import { collectDisk, createDiskUsage, parseDu, startDiskCollector } from '../src/fleet/disk.js';

const row = (id: string, avdName: string) => ({ id, name: id, handle: '@a', avdName, serial: 'emulator-5554', consolePort: 5554, mcpHostPort: 8080, mcpToken: 't', deviceSlug: id, appPackage: 'p', appVersionName: 'v', state: 'idle' as const });

describe('disco do AVD', () => {
  it('parseDu lê bytes da 1ª coluna; lixo → null', () => {
    expect(parseDu('3868131328\t/home/x/.android/avd/a.avd\n')).toBe(3868131328);
    expect(parseDu('du: cannot access')).toBeNull();
  });
  it('du -sb com cache por diskCacheMs; invalidate força nova leitura', async () => {
    const calls: string[][] = []; let t = 0; let bytes = 100;
    const disk = createDiskUsage({ home: '/avd', cacheMs: 60_000, now: () => t, exec: async (f, a) => { calls.push([f, ...a]); return { stdout: `${bytes}\t${a[1]}\n`, stderr: '', code: 0 }; } });
    expect(await disk.get('conta2')).toBe(100);
    expect(calls[0]).toEqual(['du', '-sb', '/avd/conta2.avd']);
    bytes = 200; t = 59_000;
    expect(await disk.get('conta2')).toBe(100);
    t = 60_001;
    expect(await disk.get('conta2')).toBe(200);
    bytes = 300; disk.invalidate('conta2');
    expect(await disk.get('conta2')).toBe(300);
    expect(calls).toHaveLength(3);
  });
  it('du falhou → erro com a mensagem; nome inválido recusado', async () => {
    const disk = createDiskUsage({ home: '/avd', exec: async () => ({ stdout: '', stderr: 'du: cannot access', code: 1 }) });
    await expect(disk.get('x')).rejects.toThrow(/cannot access/);
    await expect(disk.get('../etc')).rejects.toThrow(/inválido/);
  });
  it('collectDisk grava disk_bytes das não descartadas e diz se mudou', async () => {
    const db = openDb(':memory:');
    upsertIdentity(db, row('conta1', 'a1')); upsertIdentity(db, row('conta2', 'a2')); upsertIdentity(db, row('conta3', 'a3'));
    setIdentityFlags(db, 'conta3', { discardedAt: '2026-09-26T00:00:00Z', diskBytes: 0 });
    const seen: string[] = [];
    const disk = { get: async (n: string) => { seen.push(n); if (n === 'a2') throw new Error('sumiu'); return 42; }, invalidate: () => {} };
    expect(await collectDisk(db, disk)).toBe(true);
    expect(seen).toEqual(['a1', 'a2']);
    expect(getIdentity(db, 'conta1')?.diskBytes).toBe(42);
    expect(getIdentity(db, 'conta2')?.diskBytes).toBeNull();
    expect(getIdentity(db, 'conta3')?.diskBytes).toBe(0);
    expect(await collectDisk(db, disk)).toBe(false);
  });
  it('startDiskCollector: passada imediata e periódica; onChange só se mudou; stop limpa', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row('conta1', 'a1'));
    let bytes = 1; let changes = 0; const ticks: (() => void)[] = []; let cleared = 0;
    const disk = { get: async () => bytes, invalidate: () => {} };
    const stop = startDiskCollector(db, disk, () => { changes += 1; }, { setInterval: (fn) => { ticks.push(fn); return 1 as unknown as NodeJS.Timeout; }, clearInterval: () => { cleared += 1; } });
    await new Promise((r) => setTimeout(r, 5)); expect(changes).toBe(1);
    ticks[0](); await new Promise((r) => setTimeout(r, 5)); expect(changes).toBe(1);
    bytes = 2; ticks[0](); await new Promise((r) => setTimeout(r, 5)); expect(changes).toBe(2);
    stop(); expect(cleared).toBe(1);
  });
});
