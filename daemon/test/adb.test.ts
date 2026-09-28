import { describe, expect, it, vi } from 'vitest';
import { AdbError, createAdb, type Exec, type ExecBuffer } from '../src/device/adb.js';
import { CONFIG } from '../src/config.js';

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
    const exec: Exec = async (file, _a, env) => { seen.push(env); expect(file).toBe(CONFIG.adbPath); return { stdout: 'List of devices attached\nemulator-5554\tdevice\n', stderr: '', code: 0 }; };
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
  it('forward chama adb forward tcp:host <spec>', async () => {
    const { exec, calls } = fakeExec({});
    await createAdb({ exec }).forward('emulator-5554', 8081, 'tcp:8080');
    expect(calls[0]).toEqual(['-s', 'emulator-5554', 'forward', 'tcp:8081', 'tcp:8080']);
  });
  it('spy: getprop devolve valor sem \\r', async () => {
    const exec = vi.fn<Exec>(async () => ({ stdout: '1\r\n', stderr: '', code: 0 }));
    expect(await createAdb({ exec }).getprop('emulator-5554', 'sys.boot_completed')).toBe('1');
  });
});

describe.skipIf(!process.env.TAPFLOCK_INTEGRATION)('adb real (TAPFLOCK_INTEGRATION=1)', () => {
  it('enxerga emulator-5554 com boot completo', async () => {
    const adb = createAdb();
    expect(await adb.devices()).toContain('emulator-5554');
    expect(await adb.getprop('emulator-5554', 'sys.boot_completed')).toBe('1');
  });
});

describe('adb — screencap (incremento 4)', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  it('chama exec-out screencap -p com -s <serial> e devolve o Buffer bruto', async () => {
    const calls: string[][] = [];
    const execBuffer: ExecBuffer = async (_f, args) => { calls.push([...args]); return { stdout: PNG, stderr: '', code: 0 }; };
    const out = await createAdb({ execBuffer }).screencap('emulator-5554');
    expect(Buffer.isBuffer(out)).toBe(true); expect(out.equals(PNG)).toBe(true);
    expect(calls[0]).toEqual(['-s', 'emulator-5554', 'exec-out', 'screencap', '-p']);
  });
  it('device ausente → AdbError device-missing; outra falha → command', async () => {
    const missing: ExecBuffer = async () => ({ stdout: Buffer.alloc(0), stderr: "adb: device 'emulator-5554' not found", code: 1 });
    await expect(createAdb({ execBuffer: missing }).screencap('emulator-5554')).rejects.toMatchObject({ kind: 'device-missing' });
    const boom: ExecBuffer = async () => ({ stdout: Buffer.alloc(0), stderr: 'error: closed', code: 1 });
    await expect(createAdb({ execBuffer: boom }).screencap('emulator-5554')).rejects.toMatchObject({ kind: 'command' });
  });
});

describe('adb — processo e forward (incremento 4)', () => {
  it('push, forward com spec livre e forwardRemove montam os argumentos certos', async () => {
    const { exec, calls } = fakeExec({});
    const adb = createAdb({ exec });
    await adb.push('emulator-5554', '/x/server.jar', '/data/local/tmp/s.jar');
    await adb.forward('emulator-5554', 27183, 'localabstract:scrcpy_0000abcd');
    await adb.forwardRemove('emulator-5554', 27183);
    expect(calls).toEqual([
      ['-s', 'emulator-5554', 'push', '/x/server.jar', '/data/local/tmp/s.jar'],
      ['-s', 'emulator-5554', 'forward', 'tcp:27183', 'localabstract:scrcpy_0000abcd'],
      ['-s', 'emulator-5554', 'forward', '--remove', 'tcp:27183'],
    ]);
  });
  it('pull passa caminho com espaço direto ao adb, sem shell do device', async () => {
    const { exec, calls } = fakeExec({});
    await createAdb({ exec }).pull('emulator-5554', '/sdcard/Download/a b.pdf', '/tmp/x/a b.pdf');
    expect(calls).toEqual([['-s', 'emulator-5554', 'pull', '/sdcard/Download/a b.pdf', '/tmp/x/a b.pdf']]);
  });
  it('shellSpawn usa o binário, ANDROID_ADB_SERVER_PORT e `shell` + comando', () => {
    const seen: { file: string; args: readonly string[]; env: NodeJS.ProcessEnv }[] = [];
    const spawn = (file: string, args: readonly string[], opts: { env: NodeJS.ProcessEnv }) => { seen.push({ file, args, env: opts.env }); return { pid: 1, kill: () => true, on: () => undefined }; };
    createAdb({ spawn }).shellSpawn('emulator-5554', ['CLASSPATH=/a.jar', 'app_process', '/', 'X']);
    expect(seen[0].file).toBe(CONFIG.adbPath);
    expect(seen[0].args).toEqual(['-s', 'emulator-5554', 'shell', 'CLASSPATH=/a.jar', 'app_process', '/', 'X']);
    expect(seen[0].env.ANDROID_ADB_SERVER_PORT).toBe('5038');
  });
});

describe('adb — shell genérico (incremento 5)', () => {
  it('shell monta -s <serial> shell + comando e devolve a saída sem \\r', async () => {
    const { exec, calls } = fakeExec({ 'wm size': { stdout: 'Physical size: 1080x2400\r\n' } });
    expect(await createAdb({ exec }).shell('emulator-5554', ['wm', 'size'])).toBe('Physical size: 1080x2400');
    expect(calls[0]).toEqual(['-s', 'emulator-5554', 'shell', 'wm', 'size']);
  });
  it('falha do comando vira AdbError', async () => {
    const { exec } = fakeExec({ 'input': { code: 1, stderr: 'error: closed' } });
    await expect(createAdb({ exec }).shell('emulator-5554', ['input', 'tap', '1', '2'])).rejects.toMatchObject({ kind: 'command', message: 'error: closed' });
  });
});

describe('adb — console do emulador (incremento 5)', () => {
  it('emu monta -s <serial> emu <args> e devolve a saída', async () => {
    const { exec, calls } = fakeExec({ 'snapshot save': { stdout: 'OK\r\n' } });
    expect(await createAdb({ exec }).emu('emulator-5556', ['avd', 'snapshot', 'save', 'enxame'])).toBe('OK');
    expect(calls[0]).toEqual(['-s', 'emulator-5556', 'emu', 'avd', 'snapshot', 'save', 'enxame']);
  });
  it('KO: com código 0 vira AdbError command com o motivo', async () => {
    const { exec } = fakeExec({ 'snapshot load': { stdout: 'KO: snapshot enxame not found\n' } });
    await expect(createAdb({ exec }).emu('emulator-5556', ['avd', 'snapshot', 'load', 'enxame'])).rejects.toMatchObject({ kind: 'command', message: expect.stringContaining('snapshot enxame not found') });
  });
  it('device ausente no emu → device-missing', async () => {
    const { exec } = fakeExec({ emu: { code: 1, stderr: "adb: device 'emulator-5556' not found" } });
    await expect(createAdb({ exec }).emu('emulator-5556', ['kill'])).rejects.toMatchObject({ kind: 'device-missing' });
  });
  it('trimCaches roda pm trim-caches 999G', async () => {
    const { exec, calls } = fakeExec({});
    await createAdb({ exec }).trimCaches('emulator-5556');
    expect(calls[0]).toEqual(['-s', 'emulator-5556', 'shell', 'pm', 'trim-caches', '999G']);
  });
});
