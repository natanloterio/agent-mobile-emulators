import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { getIdentity, setIdentityFlags, upsertIdentity } from '../src/db/identities.js';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectDisk, createDiskUsage, dirBytes, startDiskCollector } from '../src/fleet/disk.js';

const row = (id: string, avdName: string) => ({ id, name: id, handle: '@a', avdName, serial: 'emulator-5554', consolePort: 5554, mcpHostPort: 8080, mcpToken: 't', deviceSlug: id, appPackage: 'p', appVersionName: 'v', state: 'idle' as const });

describe('disco do AVD', () => {
  it('dirBytes soma o tamanho aparente de todos os arquivos (como du -sb), sem seguir symlink', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'enxame-disk-'));
    try {
      mkdirSync(path.join(dir, 'a.avd', 'snapshots', 'enxame'), { recursive: true });
      writeFileSync(path.join(dir, 'a.avd', 'config.ini'), 'x'.repeat(100));
      writeFileSync(path.join(dir, 'a.avd', 'snapshots', 'enxame', 'ram.bin'), Buffer.alloc(5000));
      const target = path.join(dir, 'a.avd', 'snapshots');
      symlinkSync(target, path.join(dir, 'a.avd', 'link'));
      // O link conta o próprio tamanho (o caminho do alvo), não os 5000 bytes para onde aponta.
      expect(await dirBytes(path.join(dir, 'a.avd'))).toBe(5100 + Buffer.byteLength(target));
      await expect(dirBytes(path.join(dir, 'sumiu.avd'))).rejects.toThrow(/ENOENT/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('get com cache por diskCacheMs; invalidate força nova leitura', async () => {
    const calls: string[] = []; let t = 0; let bytes = 100;
    const disk = createDiskUsage({ home: '/avd', cacheMs: 60_000, now: () => t, measure: async (p) => { calls.push(p); return bytes; } });
    expect(await disk.get('conta2')).toBe(100);
    expect(calls[0]).toBe(path.join('/avd', 'conta2.avd'));
    bytes = 200; t = 59_000;
    expect(await disk.get('conta2')).toBe(100);
    t = 60_001;
    expect(await disk.get('conta2')).toBe(200);
    bytes = 300; disk.invalidate('conta2');
    expect(await disk.get('conta2')).toBe(300);
    expect(calls).toHaveLength(3);
  });
  it('medida falhou → erro com a mensagem; nome inválido recusado', async () => {
    const disk = createDiskUsage({ home: '/avd', measure: async () => { throw new Error('ENOENT: no such file'); } });
    await expect(disk.get('x')).rejects.toThrow(/x: ENOENT/);
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
