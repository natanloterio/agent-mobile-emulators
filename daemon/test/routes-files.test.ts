import { afterEach, describe, expect, it } from 'vitest';
import type { FleetFile } from '../src/db/files.js';
import { insertFile } from '../src/db/files.js';
import { upsertIdentity } from '../src/db/identities.js';
import { openDb } from '../src/db/open.js';
import { FileError, type FileService } from '../src/files/service.js';
import { startServer } from '../src/server/api.js';
import { defaultLabel, fileRoutes } from '../src/server/routes-files.js';

let stop: (() => Promise<void>) | null = null;
afterEach(async () => { await stop?.(); stop = null; });
const h = { authorization: 'Bearer seg', 'content-type': 'application/json' };
const row = (id: string) => ({ id, name: id, handle: `@${id}`, avdName: id, serial: `s-${id}`, consolePort: 5556, mcpHostPort: 8081, mcpToken: 't', deviceSlug: id, appPackage: 'com.instagram.android', appVersionName: '1', state: 'idle' as const });
const base = { name: 'a.jpg', mime: 'image/jpeg', sizeBytes: 10, sha256: 'x', hostPath: '/h/a.jpg', sourceIdentityId: 'conta1', sourceMissionId: null, sourcePath: '/sdcard/DCIM/a.jpg' };

async function mk(svc: Partial<FileService> = {}) {
  const db = openDb(':memory:'); upsertIdentity(db, row('conta1')); upsertIdentity(db, row('conta2'));
  const calls: string[] = [];
  const service: FileService = {
    recent: async (i) => { calls.push(`recent ${i.id}`); return [{ path: '/sdcard/Download/x.pdf', name: 'x.pdf', size: 3, mtime: 1 }]; },
    exportFile: async (o) => { calls.push(`export ${o.identity.id} ${o.devicePath} ${o.label}`); const id = insertFile(db, { ...base, label: o.label }); return { ...base, id, label: o.label, createdAt: '' } as FleetFile; },
    exportNewest: async () => { throw new Error('n/a'); },
    importFile: async (o) => { calls.push(`import ${o.file.label} ${o.identity.id}`); if (o.identity.id === 'conta2') throw new FileError('device', 'device indisponível'); return { devicePath: '/sdcard/Pictures/Tapflock/a.jpg' }; },
    remove: async (id) => { calls.push(`remove ${id}`); return null; },
    ...svc,
  };
  const s = await startServer({ db, port: 0, token: 'seg', onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); }, onGoal: async () => ({ goalId: 'g', done: Promise.resolve() }), routes: [fileRoutes({ service })] });
  stop = s.close;
  const req = (method: string, path: string, body?: unknown) => fetch(`http://127.0.0.1:${s.port}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  return { db, calls, req };
}

describe('rotas de arquivos', () => {
  it('GET /files lista sem caminho do host; GET /files/device/:id lista o device', async () => {
    const t = await mk();
    insertFile(t.db, { ...base, label: 'foto' });
    const list = await (await t.req('GET', '/files')).json() as { files: Record<string, unknown>[] };
    expect(list.files).toHaveLength(1);
    expect(list.files[0]).toMatchObject({ label: 'foto', name: 'a.jpg' });
    expect(list.files[0]).not.toHaveProperty('hostPath');
    const r = await t.req('GET', '/files/device/conta1');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ files: [{ path: '/sdcard/Download/x.pdf', name: 'x.pdf', size: 3, mtime: 1 }] });
    expect((await t.req('GET', '/files/device/nada')).status).toBe(404);
  });
  it('POST /files/export: 201; label padrão pelo nome; 400 corpo inválido; erros do serviço viram status', async () => {
    const t = await mk();
    const r = await t.req('POST', '/files/export', { identityId: 'conta1', devicePath: '/sdcard/Download/Relatório Final.pdf' });
    expect(r.status).toBe(201);
    expect(t.calls).toEqual(['export conta1 /sdcard/Download/Relatório Final.pdf Relat_rio_Final.pdf']);
    expect((await t.req('POST', '/files/export', { identityId: 'conta1' })).status).toBe(400);
    expect((await t.req('POST', '/files/export', { identityId: 'nada', devicePath: '/sdcard/Download/a' })).status).toBe(404);
    const big = await mk({ exportFile: async () => { throw new FileError('too-large', 'grande'); } });
    expect((await big.req('POST', '/files/export', { identityId: 'conta1', devicePath: '/sdcard/Download/a', label: 'a' })).status).toBe(413);
  });
  it('POST /files/:id/send manda para cada identidade; falha de uma não barra a outra', async () => {
    const t = await mk();
    const id = insertFile(t.db, { ...base, label: 'foto' });
    const r = await t.req('POST', `/files/${id}/send`, { identityIds: ['conta1', 'conta2'] });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ sent: [{ identityId: 'conta1', devicePath: '/sdcard/Pictures/Tapflock/a.jpg' }], failed: [{ identityId: 'conta2', error: 'device indisponível' }] });
    expect((await t.req('POST', '/files/nada/send', { identityIds: ['conta1'] })).status).toBe(404);
    expect((await t.req('POST', `/files/${id}/send`, { identityIds: [] })).status).toBe(400);
  });
  it('POST /files/:id/delete apaga; desconhecido → 404', async () => {
    const t = await mk({ remove: async (id) => (id === 'f1' ? ({ ...base, id, label: 'x', createdAt: '' } as FleetFile) : null) });
    expect((await t.req('POST', '/files/f1/delete')).status).toBe(200);
    expect((await t.req('POST', '/files/f2/delete')).status).toBe(404);
  });
  it('defaultLabel: só caracteres aceitos, até 80', () => {
    expect(defaultLabel('Foto de perfil.JPG')).toBe('Foto_de_perfil.JPG');
    expect(defaultLabel('???')).toBe('arquivo');
    expect(defaultLabel('x'.repeat(200))).toHaveLength(80);
  });
});
