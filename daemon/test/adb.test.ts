import { describe, expect, it, vi } from 'vitest';
import { AdbError, createAdb, type Exec } from '../src/device/adb.js';

function fakeExec(map: Record<string, { stdout?: string; code?: number; stderr?: string }>): { exec: Exec; calls: string[][] } {
  const calls: string[][] = [];
  const exec: Exec = async (_file, args) => {
    calls.push([...args]);
    const key = args.join(' ');
    const hit = Object.entries(map).find(([k]) => key.includes(k));
    return { stdout: hit?.[1].stdout ?? '', stderr: hit?.[1].stderr ?? '', code: hit?.[1].code ?? 0 };
  };
  return { exec, calls };
}

describe('adb isolado', () => {
  it('usa o binário do SDK e ANDROID_ADB_SERVER_PORT=5038 em toda chamada', async () => {
    const seen: NodeJS.ProcessEnv[] = [];
    const exec: Exec = async (file, _a, env) => { seen.push(env); expect(file).toBe('/home/loterio/Android/Sdk/platform-tools/adb'); return { stdout: 'List of devices attached\nemulator-5554\tdevice\n', stderr: '', code: 0 }; };
    const adb = createAdb({ exec });
    expect(await adb.devices()).toEqual(['emulator-5554']);
    expect(seen[0].ANDROID_ADB_SERVER_PORT).toBe('5038');
  });
  it('versionName extrai do dumpsys', async () => {
    const { exec } = fakeExec({ 'dumpsys package com.instagram.android': { stdout: '    versionName=448.0.0.52.84\n' } });
    expect(await createAdb({ exec }).versionName('emulator-5554', 'com.instagram.android')).toBe('448.0.0.52.84');
  });
  it('device ausente vira AdbError kind=device-missing', async () => {
    const { exec } = fakeExec({ 'getprop': { code: 1, stderr: "adb: device 'emulator-5554' not found" } });
    await expect(createAdb({ exec }).getprop('emulator-5554', 'sys.boot_completed')).rejects.toMatchObject({ kind: 'device-missing' } satisfies Partial<AdbError>);
  });
  it('broadcastConfigure monta --es/--ez/--ei pelo tipo do valor', async () => {
    const { exec, calls } = fakeExec({});
    await createAdb({ exec }).broadcastConfigure('emulator-5554', { bearer_token: 'abc', bearer_token_enabled: true, port: 8080 });
    const args = calls[0].join(' ');
    expect(args).toContain('--es bearer_token abc');
    expect(args).toContain('--ez bearer_token_enabled true');
    expect(args).toContain('--ei port 8080');
    expect(args).toContain('com.danielealbano.androidremotecontrolmcp.ADB_CONFIGURE');
  });
  it('forward chama adb forward tcp:host tcp:device', async () => {
    const { exec, calls } = fakeExec({});
    await createAdb({ exec }).forward('emulator-5554', 8081, 8080);
    expect(calls[0]).toEqual(['-s', 'emulator-5554', 'forward', 'tcp:8081', 'tcp:8080']);
  });
  it('spy: getprop devolve valor sem \\r', async () => {
    const exec = vi.fn<Exec>(async () => ({ stdout: '1\r\n', stderr: '', code: 0 }));
    expect(await createAdb({ exec }).getprop('emulator-5554', 'sys.boot_completed')).toBe('1');
  });
});

describe.skipIf(!process.env.ENXAME_INTEGRATION)('adb real (ENXAME_INTEGRATION=1)', () => {
  it('enxerga emulator-5554 com boot completo', async () => {
    const adb = createAdb();
    expect(await adb.devices()).toContain('emulator-5554');
    expect(await adb.getprop('emulator-5554', 'sys.boot_completed')).toBe('1');
  });
});
