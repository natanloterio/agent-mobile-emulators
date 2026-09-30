import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { upsertIdentity } from '../src/db/identities.js';
import { createMission } from '../src/db/missions.js';
import type { FleetFile } from '../src/db/files.js';
import { FileError } from '../src/files/service.js';
import { createSecretMask, missionTools, type MissionFiles } from '../src/worker/mission-tools.js';
import { memVault } from './fixtures/mem-vault.js';

const row = { id: 'conta2', name: 'conta2', handle: '@c2', avdName: 'x', serial: 's', consolePort: 5556, mcpHostPort: 8081, mcpToken: 't', deviceSlug: 'conta2', appPackage: 'com.instagram.android', appVersionName: '1', state: 'running' as const };
const exec = (tools: Record<string, unknown>, name: string, input: unknown) =>
  (tools[name] as { execute: (i: unknown, o: unknown) => Promise<unknown> }).execute(input, { toolCallId: 'c', messages: [] });
const file = (over: Partial<FleetFile> = {}): FleetFile => ({ id: 'f1', label: 'foto', name: 'a.jpg', mime: 'image/jpeg', sizeBytes: 2048, sha256: 'x', hostPath: '/h', sourceIdentityId: 'conta1', sourceMissionId: null, sourcePath: '/sdcard/DCIM/a.jpg', createdAt: 'agora', ...over });

function setup(files?: MissionFiles) {
  const db = openDb(':memory:'); upsertIdentity(db, row);
  const missionId = createMission(db, 'conta2', 'missão', 'pt');
  return missionTools({ db, missionId, vault: memVault(), mask: createSecretMask(), files, typeText: async () => {}, onFinish: () => {}, onHuman: () => {}, onVaultError: () => {} });
}

describe('screen_capture', () => {
  it('só existe com captura no serviço; recorta pelos bounds da tela e devolve onde ficou na galeria', async () => {
    expect(Object.keys(setup({ list: () => [], exportFile: async () => file(), importFile: async () => ({ devicePath: '' }) }))).not.toContain('screen_capture');
    const calls: unknown[] = [];
    const t = setup({ list: () => [], exportFile: async () => file(), importFile: async () => ({ devicePath: '' }),
      capture: async (label, crop) => { calls.push([label, crop]); return { file: file({ label, mime: 'image/png', name: `${label}.png` }), devicePath: `/sdcard/Pictures/Tapflock/${label}.png` }; } });
    expect(await exec(t, 'screen_capture', { label: 'post', bounds: '0,210,1080,1290' })).toEqual({ label: 'post', device_path: '/sdcard/Pictures/Tapflock/post.png', in_gallery: true });
    await exec(t, 'screen_capture', { label: 'tela' });
    expect(calls).toEqual([['post', { left: 0, top: 210, right: 1080, bottom: 1290 }], ['tela', undefined]]);
    await expect(exec(t, 'screen_capture', { label: 'x', bounds: 'metade de cima' })).rejects.toThrow(/bounds/);
  });
});

describe('tools de arquivo da missão', () => {
  it('sem serviço de arquivos, as tools não existem', () => {
    const t = setup();
    expect(Object.keys(t)).not.toContain('file_export');
    expect(Object.keys(t)).not.toContain('file_import');
  });
  it('file_export com e sem caminho; devolve nome, tipo e tamanho', async () => {
    const calls: unknown[] = [];
    const t = setup({ list: () => [], exportFile: async (label, devicePath) => { calls.push([label, devicePath]); return file({ label }); }, importFile: async () => ({ devicePath: '' }) });
    expect(await exec(t, 'file_export', { label: 'foto' })).toEqual({ label: 'foto', name: 'a.jpg', mime: 'image/jpeg', size_bytes: 2048 });
    await exec(t, 'file_export', { label: 'pdf', device_path: '/sdcard/Download/x.pdf' });
    expect(calls).toEqual([['foto', undefined], ['pdf', '/sdcard/Download/x.pdf']]);
  });
  it('file_import devolve o caminho no device; erro de arquivo vira erro de tool com a mensagem', async () => {
    const t = setup({ list: () => [], exportFile: async () => { throw new FileError('none', 'nenhum arquivo novo'); }, importFile: async (label) => ({ devicePath: `/sdcard/Pictures/Tapflock/${label}.jpg` }) });
    expect(await exec(t, 'file_import', { label: 'foto' })).toEqual({ device_path: '/sdcard/Pictures/Tapflock/foto.jpg' });
    await expect(exec(t, 'file_export', { label: 'x' })).rejects.toThrow('nenhum arquivo novo');
  });
  it('file_list mostra os arquivos da frota', async () => {
    const t = setup({ list: () => [file()], exportFile: async () => file(), importFile: async () => ({ devicePath: '' }) });
    expect(await exec(t, 'file_list', {})).toEqual({ files: [{ label: 'foto', name: 'a.jpg', mime: 'image/jpeg', size_bytes: 2048, from: 'conta1' }] });
  });
});
