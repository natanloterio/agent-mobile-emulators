import { describe, expect, it } from 'vitest';
import { insertFile, type FleetFile } from '../src/db/files.js';
import { setIdentityFlags, upsertIdentity, type IdentityRow } from '../src/db/identities.js';
import { listNotes } from '../src/db/mission-notes.js';
import { getMission, setMissionState } from '../src/db/missions.js';
import { openDb } from '../src/db/open.js';
import { FileError } from '../src/files/service.js';
import type { MissionDeps } from '../src/mission/loop.js';
import { createMissionRunner, MissionError } from '../src/mission/runner.js';

const row = (id: string) => ({ id, name: id, handle: `@${id}`, avdName: id, serial: `s-${id}`, consolePort: 5556, mcpHostPort: 8081, mcpToken: 't', deviceSlug: id, appPackage: 'com.instagram.android', appVersionName: '1', state: 'idle' as const });
const JPEG: Omit<FleetFile, 'id' | 'createdAt' | 'label' | 'sourceMissionId'> = { name: 'a.jpg', mime: 'image/jpeg', sizeBytes: 10, sha256: 'x', hostPath: '/h/a.jpg', sourceIdentityId: 'conta1', sourcePath: '/sdcard/DCIM/a.jpg' };

interface Opts { exportFails?: boolean; importFails?: boolean; killed?: () => boolean; finish?: 'done' | 'running' }
function mk(o: Opts = {}) {
  const db = openDb(':memory:');
  for (const id of ['conta1', 'conta2', 'conta3']) upsertIdentity(db, row(id));
  const ran: string[] = []; const exported: { identity: string; label: string; missionId: string | null }[] = []; const imported: { identity: string; label: string }[] = [];
  const sinceSecs: number[] = [];
  const files = {
    exportNewest: async (x: { identity: IdentityRow; sinceSec: number; label: string; missionId: string | null }) => {
      if (o.exportFails) throw new FileError('none', 'nenhum arquivo novo');
      exported.push({ identity: x.identity.id, label: x.label, missionId: x.missionId }); sinceSecs.push(x.sinceSec);
      const id = insertFile(db, { ...JPEG, label: x.label, sourceMissionId: x.missionId });
      return { ...JPEG, id, label: x.label, sourceMissionId: x.missionId, createdAt: '' };
    },
    importFile: async (x: { file: FleetFile; identity: IdentityRow }) => {
      if (o.importFails) throw new FileError('device', 'device indisponível');
      imported.push({ identity: x.identity.id, label: x.file.label });
      return { devicePath: `/sdcard/Pictures/Tapflock/${x.file.name}` };
    },
  };
  const deps = { db, isKilled: o.killed ?? (() => false), files } as unknown as MissionDeps;
  const runner = createMissionRunner({ ...deps, run: async (id) => { ran.push(id); setMissionState(db, id, o.finish ?? 'done'); return o.finish ?? 'done'; } });
  return { db, runner, ran, exported, imported, sinceSecs };
}
const status = (f: () => unknown) => { try { f(); return 0; } catch (e) { return (e as MissionError).status; } };

describe('missões encadeadas', () => {
  it('cria a primeira rodando e as outras esperando, com label de entrega e nota de quem entrega', async () => {
    const h = mk({ finish: 'running' });
    const ids = h.runner.startChain([{ identityId: 'conta1', text: 'baixe a foto' }, { identityId: 'conta2', text: 'poste a foto' }], 'pt');
    const [a, b] = ids.map((id) => getMission(h.db, id));
    expect(a).toMatchObject({ identityId: 'conta1', waitFor: null });
    expect(a?.handoffLabel).toMatch(/^handoff\.[a-z0-9]{8}\.1$/);
    expect(b).toMatchObject({ identityId: 'conta2', waitFor: ids[0], handoffLabel: null, state: 'waiting' });
    expect(listNotes(h.db, ids[0])[0].text).toContain(`file_export(label="${a?.handoffLabel}")`);
    expect(listNotes(h.db, ids[0])[0].text).toContain('conta2');
    expect(h.ran).toEqual([ids[0]]);
    await h.runner.settle();
  });
  it('anterior terminou: exporta o mais novo com o label, importa na próxima, deixa nota com o caminho e lança', async () => {
    const h = mk();
    const ids = h.runner.startChain([{ identityId: 'conta1', text: 'baixe' }, { identityId: 'conta2', text: 'poste' }, { identityId: 'conta3', text: 'arquive' }], 'pt');
    await h.runner.settle();
    expect(h.ran).toEqual(ids);
    const labels = ids.map((id) => getMission(h.db, id)?.handoffLabel);
    expect(h.exported).toEqual([{ identity: 'conta1', label: labels[0], missionId: ids[0] }, { identity: 'conta2', label: labels[1], missionId: ids[1] }]);
    expect(h.imported).toEqual([{ identity: 'conta2', label: labels[0] }, { identity: 'conta3', label: labels[1] }]);
    expect(listNotes(h.db, ids[1]).map((n) => n.text).join('\n')).toContain('/sdcard/Pictures/Tapflock/a.jpg');
  });
  it('"mais novo desde o início" conta do início da etapa, não da criação da sequência', async () => {
    const h = mk();
    const seen: number[] = [];
    const ids = h.runner.startChain([{ identityId: 'conta1', text: 'baixe' }, { identityId: 'conta2', text: 'edite' }, { identityId: 'conta3', text: 'poste' }], 'pt');
    h.db.prepare("update goal set created_at='2020-01-01 00:00:00' where pattern='mission'").run();
    await h.runner.settle();
    for (const e of h.exported) seen.push(e.label ? 1 : 0);
    expect(seen).toEqual([1, 1]);
    const rows = h.db.prepare('select id, run_started_at from goal where id in (?, ?)').all(ids[1], ids[2]) as { id: string; run_started_at: string | null }[];
    expect(rows.every((r) => r.run_started_at && r.run_started_at > '2025')).toBe(true);
    expect(h.sinceSecs.every((x) => x > Date.UTC(2025, 0, 1) / 1000)).toBe(true);
  });
  it('envio falhou: a etapa pausada ganha nota com o label para file_import ao retomar', async () => {
    const h = mk({ importFails: true });
    const ids = h.runner.startChain([{ identityId: 'conta1', text: 'baixe' }, { identityId: 'conta2', text: 'poste' }], 'pt');
    await h.runner.settle();
    const label = getMission(h.db, ids[0])?.handoffLabel as string;
    expect(listNotes(h.db, ids[1]).map((n) => n.text).join('\n')).toContain(`file_import(label="${label}")`);
  });
  it('arquivo já exportado pela própria missão com o label não é puxado de novo', async () => {
    const h = mk();
    const ids = h.runner.startChain([{ identityId: 'conta1', text: 'baixe' }, { identityId: 'conta2', text: 'poste' }], 'pt');
    // Antes do loop "terminar", o executor já exportou (file_export).
    insertFile(h.db, { ...JPEG, label: getMission(h.db, ids[0])?.handoffLabel as string, sourceMissionId: ids[0] });
    await h.runner.settle();
    expect(h.exported).toEqual([]);
    expect(h.imported).toHaveLength(1);
  });
  it('sem arquivo para entregar: a próxima pausa com o motivo e não roda', async () => {
    const h = mk({ exportFails: true });
    const ids = h.runner.startChain([{ identityId: 'conta1', text: 'baixe' }, { identityId: 'conta2', text: 'poste' }], 'pt');
    await h.runner.settle();
    expect(getMission(h.db, ids[1])).toMatchObject({ state: 'paused' });
    expect(getMission(h.db, ids[1])?.humanReason).toContain('nenhum arquivo novo');
    expect(h.ran).toEqual([ids[0]]);
  });
  it('envio para o device falhou ou identidade bloqueada: pausa com o motivo', async () => {
    const h = mk({ importFails: true });
    const ids = h.runner.startChain([{ identityId: 'conta1', text: 'baixe' }, { identityId: 'conta2', text: 'poste' }], 'pt');
    await h.runner.settle();
    expect(getMission(h.db, ids[1])?.humanReason).toContain('device indisponível');
    const h2 = mk();
    const ids2 = h2.runner.startChain([{ identityId: 'conta1', text: 'baixe' }, { identityId: 'conta2', text: 'poste' }], 'pt');
    setIdentityFlags(h2.db, 'conta2', { paused: true });
    await h2.runner.settle();
    expect(getMission(h2.db, ids2[1])).toMatchObject({ state: 'paused', humanReason: 'identidade pausada' });
    expect(h2.imported).toEqual([]);
  });
  it('anterior abandonada: a próxima pausa; esperando pode ser abandonada', async () => {
    const h = mk({ finish: 'running' });
    const ids = h.runner.startChain([{ identityId: 'conta1', text: 'a' }, { identityId: 'conta2', text: 'b' }, { identityId: 'conta3', text: 'c' }], 'pt');
    await h.runner.settle();
    h.runner.abandon(ids[0]);
    expect(getMission(h.db, ids[1])).toMatchObject({ state: 'paused', humanReason: 'a etapa anterior foi abandonada' });
    expect(h.runner.abandon(ids[2])).toBe('abandoned');
  });
  it('recusa sequência com identidade ocupada, desconhecida ou com kill switch, sem criar nada', () => {
    const h = mk({ finish: 'running' });
    h.runner.start('conta2', 'ocupada', 'pt');
    expect(status(() => h.runner.startChain([{ identityId: 'conta1', text: 'a' }, { identityId: 'conta2', text: 'b' }], 'pt'))).toBe(409);
    expect(status(() => h.runner.startChain([{ identityId: 'conta1', text: 'a' }, { identityId: 'nada', text: 'b' }], 'pt'))).toBe(404);
    expect(status(() => mk({ killed: () => true }).runner.startChain([{ identityId: 'conta1', text: 'a' }, { identityId: 'conta2', text: 'b' }], 'pt'))).toBe(409);
    expect(h.db.prepare("select count(*) as n from goal where identity_id='conta1'").get()).toEqual({ n: 0 });
  });
  it('ao subir o daemon: esperando cuja anterior já terminou recebe o arquivo e roda', async () => {
    const h = mk();
    const ids = h.runner.startChain([{ identityId: 'conta1', text: 'a' }, { identityId: 'conta2', text: 'b' }], 'pt');
    await h.runner.settle();
    // Simula queda antes da entrega: volta a segunda para waiting.
    setMissionState(h.db, ids[1], 'waiting');
    const h2 = createMissionRunner({ ...({ db: h.db, isKilled: () => false, files: { exportNewest: async () => { throw new Error('não deveria'); }, importFile: async () => ({ devicePath: '/x' }) } } as unknown as MissionDeps), run: async (id) => { setMissionState(h.db, id, 'done'); return 'done'; } });
    expect(h2.resumeAllOnStart()).toBe(0);
    await h2.settle();
    expect(getMission(h.db, ids[1])?.state).toBe('done');
  });
});
