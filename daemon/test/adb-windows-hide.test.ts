import { EventEmitter } from 'node:events';
import { execFile, spawn } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { createAdb } from '../src/device/adb.js';

// Windows: sem windowsHide cada chamada ao adb abre uma janela de console.
vi.mock('node:child_process', () => ({
  execFile: vi.fn((_f: string, _a: string[], _o: unknown, cb: (e: null, out: string | Buffer, err: string) => void) => { cb(null, Buffer.from(''), ''); }),
  spawn: vi.fn(() => Object.assign(new EventEmitter(), { stdout: null, stderr: null, kill: () => true })),
}));

describe('adb padrão esconde a janela no Windows', () => {
  it('exec, execBuffer e spawn passam windowsHide: true', async () => {
    const adb = createAdb({ adbPath: 'adb' });
    await adb.devices();
    await adb.screencap('emulator-5554').catch(() => undefined);
    adb.shellSpawn('emulator-5554', ['logcat']);
    const execCalls = vi.mocked(execFile).mock.calls;
    expect(execCalls.length).toBeGreaterThanOrEqual(2);
    for (const c of execCalls) expect(c[2]).toMatchObject({ windowsHide: true });
    expect(vi.mocked(spawn).mock.calls[0][2]).toMatchObject({ windowsHide: true });
  });
});
