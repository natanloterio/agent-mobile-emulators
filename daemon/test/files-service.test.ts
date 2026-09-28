import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { upsertIdentity, getIdentity, type IdentityRow } from '../src/db/identities.js';
import { getFile, listFiles } from '../src/db/files.js';
import { openDb } from '../src/db/open.js';
import { AdbError } from '../src/device/adb.js';
import { createFileService, FileError } from '../src/files/service.js';

const row = (id: string, serial: string) => ({ id, name: id, handle: `@${id}`, avdName: id, serial, consolePort: 5554, mcpHostPort: 8080, mcpToken: 't', deviceSlug: id, appPackage: 'com.instagram.android', appVersionName: '1', state: 'idle' as const });
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 7)]);

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

/** Device falso: arquivos por serial; `pull` grava no host, `push` guarda o que chegou, `shell` responde stat/find/mkdir/am. */
function fakeDevices(files: Record<string, Record<string, Buffer>>) {
  const pushed: { serial: string; local: string; remote: string; bytes: Buffer }[] = [];
  const shells: string[] = [];
  const adb = {
    shell: async (serial: string, cmd: readonly string[]) => {
      const c = cmd.join(' '); shells.push(`${serial}: ${c}`);
      const dev = files[serial]; if (!dev) throw new AdbError('device-missing', `device '${serial}' not found`);
      if (c.startsWith('find ')) return Object.entries(dev).map(([p, b], i) => `${1000 + i}|${b.length}|${p}`).join('\n');
      const st = /^stat -c '%F\|%s' '(.+)' 2>/.exec(c);
      if (st) {
        const p = st[1].replace(/'\\''/g, "'");
        if (Object.keys(dev).some((k) => k.startsWith(`${p}/`))) return 'directory|4096';
        const b = dev[p]; return b ? `regular file|${b.length}` : '';
      }
      const ex = /^test -e '(.+)' && echo sim/.exec(c);
      if (ex) return dev[ex[1]] || pushed.some((x) => x.serial === serial && x.remote === ex[1]) ? 'sim' : '';
      return '';
    },
    pull: async (serial: string, remote: string, local: string) => {
      const b = files[serial]?.[remote]; if (!b) throw new AdbError('command', 'remote object does not exist');
      fs.writeFileSync(local, b);
    },
    push: async (serial: string, local: string, remote: string) => { pushed.push({ serial, local, remote, bytes: fs.readFileSync(local) }); },
  };
  return { adb, pushed, shells };
}

function setup(files: Record<string, Record<string, Buffer>>, maxBytes = 1024) {
  const db = openDb(':memory:');
  upsertIdentity(db, row('conta1', 'emulator-5554')); upsertIdentity(db, row('conta2', 'emulator-5556'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-files-')); dirs.push(dir);
  const dev = fakeDevices(files);
  const svc = createFileService({ db, adb: dev.adb, dir, maxBytes, recentLimit: 10 });
  const id = (x: string) => getIdentity(db, x) as IdentityRow;
  return { db, dir, svc, id, ...dev };
}

describe('exportar', () => {
  it('puxa para <dir>/<id>/<nome>, grava tipo pelos bytes, tamanho e sha256', async () => {
    const s = setup({ 'emulator-5554': { '/sdcard/Download/foto final.txt': JPEG } });
    const f = await s.svc.exportFile({ identity: s.id('conta1'), devicePath: '/sdcard/Download/foto final.txt', label: 'foto', missionId: null });
    expect(f).toMatchObject({ label: 'foto', name: 'foto final.txt', mime: 'image/jpeg', sizeBytes: JPEG.length, sourceIdentityId: 'conta1', sourcePath: '/sdcard/Download/foto final.txt' });
    expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(f.hostPath).toBe(path.join(s.dir, f.id, 'foto final.txt'));
    expect(fs.readFileSync(f.hostPath)).toEqual(JPEG);
    expect(getFile(s.db, f.id)?.id).toBe(f.id);
  });
  it('recusa caminho fora das pastas compartilhadas e label inválido, sem tocar no device', async () => {
    const s = setup({ 'emulator-5554': {} });
    await expect(s.svc.exportFile({ identity: s.id('conta1'), devicePath: '/data/data/x/a', label: 'a', missionId: null })).rejects.toMatchObject({ kind: 'bad-path' });
    await expect(s.svc.exportFile({ identity: s.id('conta1'), devicePath: '/sdcard/Download/a', label: 'com espaço', missionId: null })).rejects.toMatchObject({ kind: 'bad-label' });
    expect(s.shells).toEqual([]);
  });
  it('arquivo inexistente → not-found; grande demais → too-large, nada fica no disco', async () => {
    const s = setup({ 'emulator-5554': { '/sdcard/Download/g.bin': Buffer.alloc(2048) } });
    await expect(s.svc.exportFile({ identity: s.id('conta1'), devicePath: '/sdcard/Download/x', label: 'x', missionId: null })).rejects.toMatchObject({ kind: 'not-found' });
    await expect(s.svc.exportFile({ identity: s.id('conta1'), devicePath: '/sdcard/Download/g.bin', label: 'g', missionId: null })).rejects.toMatchObject({ kind: 'too-large' });
    expect(fs.readdirSync(s.dir)).toEqual([]);
    expect(listFiles(s.db, 10)).toEqual([]);
  });
  it('device fora do adb → kind device', async () => {
    const s = setup({});
    await expect(s.svc.exportFile({ identity: s.id('conta1'), devicePath: '/sdcard/Download/a', label: 'a', missionId: null })).rejects.toBeInstanceOf(FileError);
    await expect(s.svc.exportFile({ identity: s.id('conta1'), devicePath: '/sdcard/Download/a', label: 'a', missionId: null })).rejects.toMatchObject({ kind: 'device' });
  });
  it('exportNewest pega o arquivo mais novo desde o instante dado; nenhum → none', async () => {
    const s = setup({ 'emulator-5554': { '/sdcard/Download/velho.pdf': Buffer.from('%PDF-1'), '/sdcard/DCIM/novo.jpg': JPEG } });
    const f = await s.svc.exportNewest({ identity: s.id('conta1'), sinceSec: 1000, label: 'h', missionId: 'm1' });
    expect(f).toMatchObject({ name: 'novo.jpg', sourceMissionId: 'm1' });
    await expect(s.svc.exportNewest({ identity: s.id('conta1'), sinceSec: 5000, label: 'h', missionId: null })).rejects.toMatchObject({ kind: 'none' });
  });
});

describe('correções da revisão', () => {
  it('pasta não é exportada (o limite de tamanho não vale para árvore inteira)', async () => {
    const s = setup({ 'emulator-5554': { '/sdcard/DCIM/Camera/a.jpg': JPEG } });
    await expect(s.svc.exportFile({ identity: s.id('conta1'), devicePath: '/sdcard/DCIM/Camera', label: 'x', missionId: null })).rejects.toMatchObject({ kind: 'not-found' });
  });
  it('destrava o device antes de mexer nele', async () => {
    const s = setup({ 'emulator-5554': { '/sdcard/Download/a.jpg': JPEG } });
    const unlocked: string[] = [];
    const svc = createFileService({ db: s.db, adb: s.adb, dir: s.dir, maxBytes: 1024, recentLimit: 10, unlock: async (i) => { unlocked.push(i.id); } });
    await svc.recent(s.id('conta1'));
    await svc.exportFile({ identity: s.id('conta1'), devicePath: '/sdcard/Download/a.jpg', label: 'a', missionId: null });
    expect(unlocked).toEqual(['conta1', 'conta1']);
  });
  it('nome repetido no destino ganha sufixo; extensão acompanha o tipo', async () => {
    const s = setup({ 'emulator-5554': { '/sdcard/Download/download': JPEG }, 'emulator-5556': { '/sdcard/Pictures/Tapflock/download.jpg': JPEG } });
    const f = await s.svc.exportFile({ identity: s.id('conta1'), devicePath: '/sdcard/Download/download', label: 'a', missionId: null });
    const r = await s.svc.importFile({ file: f, identity: s.id('conta2') });
    expect(r.devicePath).toBe(`/sdcard/Pictures/Tapflock/download-${f.id.slice(0, 6)}.jpg`);
  });
  it('media scan que falha não derruba o envio', async () => {
    const s = setup({ 'emulator-5554': { '/sdcard/Download/a.jpg': JPEG }, 'emulator-5556': {} });
    const f = await s.svc.exportFile({ identity: s.id('conta1'), devicePath: '/sdcard/Download/a.jpg', label: 'a', missionId: null });
    const shell = s.adb.shell;
    s.adb.shell = async (serial, cmd) => { if (cmd.join(' ').startsWith('am broadcast')) throw new Error('am falhou'); return shell(serial, cmd); };
    expect((await s.svc.importFile({ file: f, identity: s.id('conta2') })).devicePath).toBe('/sdcard/Pictures/Tapflock/a.jpg');
  });
  it('exportNewest ignora o que veio por import (pastas Tapflock)', async () => {
    const s = setup({ 'emulator-5554': { '/sdcard/Pictures/Tapflock/veio.jpg': JPEG } });
    await expect(s.svc.exportNewest({ identity: s.id('conta1'), sinceSec: 0, label: 'h', missionId: null })).rejects.toMatchObject({ kind: 'none' });
  });
});

describe('importar e apagar', () => {
  it('envia para a pasta do tipo com nome seguro, cria a pasta e avisa o MediaStore', async () => {
    const s = setup({ 'emulator-5554': { '/sdcard/Download/a.jpg': JPEG }, 'emulator-5556': {} });
    const f = await s.svc.exportFile({ identity: s.id('conta1'), devicePath: '/sdcard/Download/a.jpg', label: 'a', missionId: null });
    const r = await s.svc.importFile({ file: f, identity: s.id('conta2') });
    expect(r.devicePath).toBe('/sdcard/Pictures/Tapflock/a.jpg');
    expect(s.pushed).toEqual([{ serial: 'emulator-5556', local: f.hostPath, remote: '/sdcard/Pictures/Tapflock/a.jpg', bytes: JPEG }]);
    const mine = s.shells.filter((c) => c.startsWith('emulator-5556'));
    expect(mine[0]).toBe("emulator-5556: mkdir -p '/sdcard/Pictures/Tapflock'");
    expect(mine.at(-1)).toContain('MEDIA_SCANNER_SCAN_FILE');
  });
  it('arquivo sumido do host → not-found, sem push', async () => {
    const s = setup({ 'emulator-5554': { '/sdcard/Download/a.jpg': JPEG }, 'emulator-5556': {} });
    const f = await s.svc.exportFile({ identity: s.id('conta1'), devicePath: '/sdcard/Download/a.jpg', label: 'a', missionId: null });
    fs.rmSync(f.hostPath);
    await expect(s.svc.importFile({ file: f, identity: s.id('conta2') })).rejects.toMatchObject({ kind: 'not-found' });
    expect(s.pushed).toEqual([]);
  });
  it('remove apaga linha e pasta', async () => {
    const s = setup({ 'emulator-5554': { '/sdcard/Download/a.jpg': JPEG } });
    const f = await s.svc.exportFile({ identity: s.id('conta1'), devicePath: '/sdcard/Download/a.jpg', label: 'a', missionId: null });
    expect((await s.svc.remove(f.id))?.id).toBe(f.id);
    expect(fs.existsSync(path.dirname(f.hostPath))).toBe(false);
    expect(await s.svc.remove(f.id)).toBeNull();
  });
  it('recent lista o device mais novo primeiro', async () => {
    const s = setup({ 'emulator-5554': { '/sdcard/Download/a': Buffer.from('1'), '/sdcard/Download/b': Buffer.from('22') } });
    expect((await s.svc.recent(s.id('conta1'))).map((f) => f.name)).toEqual(['b', 'a']);
  });
});
