import { describe, expect, it } from 'vitest';
import { insertFile } from '../src/db/files.js';
import { getIdentity, upsertIdentity, type IdentityRow } from '../src/db/identities.js';
import { createMission } from '../src/db/missions.js';
import { openDb } from '../src/db/open.js';
import { bindMissionFiles, missionSinceSec } from '../src/files/mission-files.js';
import type { FileService } from '../src/files/service.js';

const row = { id: 'conta2', name: 'conta2', handle: '@c2', avdName: 'x', serial: 's', consolePort: 5556, mcpHostPort: 8081, mcpToken: 't', deviceSlug: 'conta2', appPackage: 'p', appVersionName: '1', state: 'idle' as const };

describe('arquivos presos à missão', () => {
  it('missionSinceSec: início da missão menos 60 s; data inválida → 0', () => {
    expect(missionSinceSec('2026-09-28 12:00:00')).toBe(Date.UTC(2026, 8, 28, 12, 0, 0) / 1000 - 60);
    expect(missionSinceSec(undefined)).toBe(0);
    expect(missionSinceSec('lixo')).toBe(0);
  });
  it('export sem caminho usa o mais novo desde o início; com caminho, o caminho; import resolve pelo label', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const missionId = createMission(db, 'conta2', 'x', 'pt');
    const calls: unknown[] = [];
    const svc = {
      exportNewest: async (o: { sinceSec: number; label: string; missionId: string | null }) => { calls.push(['newest', o.label, o.missionId, o.sinceSec > 0]); return null; },
      exportFile: async (o: { devicePath: string; label: string }) => { calls.push(['path', o.devicePath, o.label]); return null; },
      importFile: async (o: { file: { name: string }; identity: IdentityRow }) => { calls.push(['import', o.file.name, o.identity.id]); return { devicePath: '/d' }; },
    } as unknown as FileService;
    const f = bindMissionFiles(svc, db, getIdentity(db, 'conta2') as IdentityRow, missionId);
    await f.exportFile('a');
    await f.exportFile('b', '/sdcard/Download/b.pdf');
    await expect(f.importFile('nada')).rejects.toMatchObject({ kind: 'not-found' });
    insertFile(db, { label: 'foto', name: 'a.jpg', mime: 'image/jpeg', sizeBytes: 1, sha256: '', hostPath: '/h', sourceIdentityId: 'conta1', sourceMissionId: null, sourcePath: null });
    expect(await f.importFile('foto')).toEqual({ devicePath: '/d' });
    expect(calls).toEqual([['newest', 'a', missionId, true], ['path', '/sdcard/Download/b.pdf', 'b'], ['import', 'a.jpg', 'conta2']]);
    expect(f.list().map((x) => x.label)).toEqual(['foto']);
  });
});
