import { describe, expect, it } from 'vitest';
import { createFileActions, filesKey, parseDeviceFiles } from './fileActions';

function mk(reply: unknown = {}, confirmAnswer = true) {
  const calls: { method: string; path: string; body?: unknown }[] = []; const actions: unknown[] = [];
  const bridge = { api: async (method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) => { calls.push({ method, path, body }); return reply; } };
  const a = createFileActions({ dispatch: (x) => actions.push(x), getBridge: () => bridge, confirm: () => confirmAnswer, getLocale: () => 'en' });
  return { a, calls, actions };
}

describe('fileActions', () => {
  it('listDevice lê a lista do device e descarta entradas malformadas', async () => {
    const t = mk({ files: [{ path: '/sdcard/Download/a.pdf', name: 'a.pdf', size: 3, mtime: 9 }, { name: 'sem caminho' }] });
    expect(await t.a.listDevice('conta1')).toEqual([{ path: '/sdcard/Download/a.pdf', name: 'a.pdf', size: 3, mtime: 9 }]);
    expect(t.calls).toEqual([{ method: 'GET', path: '/files/device/conta1', body: undefined }]);
    expect(t.actions).toContainEqual({ type: 'request', key: filesKey('conta1'), phase: 'ok' });
  });
  it('exportFile e send montam o corpo; send com falha parcial mostra quem não recebeu', async () => {
    const t = mk({ sent: [{ identityId: 'conta1' }], failed: [{ identityId: 'conta2', error: 'device offline' }] });
    expect(await t.a.exportFile('conta1', '/sdcard/Download/a.pdf')).toBe(true);
    expect(await t.a.send('f1', ['conta1', 'conta2'], 'k')).toBe(false);
    expect(t.calls.map((c) => [c.path, c.body])).toEqual([
      ['/files/export', { identityId: 'conta1', devicePath: '/sdcard/Download/a.pdf' }],
      ['/files/f1/send', { identityIds: ['conta1', 'conta2'] }],
    ]);
    expect(t.actions.at(-1)).toEqual({ type: 'requestError', key: 'k', message: 'Did not reach: conta2 (device offline)' });
  });
  it('remove pede confirmação; recusada não chama o daemon', async () => {
    const no = mk({}, false);
    expect(await no.a.remove('f1', 'a.pdf', 'k')).toBe(false);
    expect(no.calls).toEqual([]);
    const yes = mk({ deleted: 'f1' });
    expect(await yes.a.remove('f1', 'a.pdf', 'k')).toBe(true);
    expect(yes.calls).toEqual([{ method: 'POST', path: '/files/f1/delete', body: undefined }]);
  });
  it('parseDeviceFiles aceita forma inesperada', () => {
    expect(parseDeviceFiles(null)).toEqual([]);
    expect(parseDeviceFiles({ files: 'x' })).toEqual([]);
  });
});
