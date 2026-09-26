import { describe, expect, it } from 'vitest';
import type { Adb } from '../src/device/adb.js';
import { AdbError } from '../src/device/adb.js';
import { probeIdentity } from '../src/device/probe.js';
import { WORKER_TOOL_SUFFIXES } from '../src/worker/tools.js';

const identity = {
  id: 'conta1', name: 'conta1', handle: '@a', avdName: 'x', serial: 'emulator-5554', consolePort: 5554, mcpHostPort: 8080,
  mcpToken: 't', deviceSlug: 'conta1', appPackage: 'com.instagram.android', appVersionName: '448.0.0.52.84', state: 'logged-in' as const,
};
const okAdb = (over: Partial<Adb> = {}): Adb => ({
  devices: async () => ['emulator-5554'],
  getprop: async () => '1',
  settingsGetSecure: async () => 'com.danielealbano.androidremotecontrolmcp.gms.debug/com.danielealbano.androidremotecontrolmcp.services.accessibility.McpAccessibilityService',
  versionName: async () => '448.0.0.52.84',
  forward: async () => {}, forwardRemove: async () => {}, push: async () => {},
  shellSpawn: () => ({ pid: 1, kill: () => true, on: () => undefined }), shell: async () => '',
  broadcastConfigure: async () => {}, startTrampoline: async () => {}, screencap: async () => Buffer.alloc(0), emu: async () => 'OK', trimCaches: async () => undefined,
  ...over,
});
const okMcp = async () => ({
  tools: async () => Object.fromEntries(WORKER_TOOL_SUFFIXES.map((s) => [`android_conta1_${s}`, {}])) as never,
  close: async () => {},
});

describe('probeIdentity', () => {
  it('5 sinais verdes → ready', async () => {
    const r = await probeIdentity(identity, { adb: okAdb(), mcp: okMcp });
    expect(r.ready).toBe(true);
    expect(Object.values(r.signals).every(Boolean)).toBe(true);
  });
  it('versionName diferente → não pronto, classe version, os outros sinais ainda avaliados', async () => {
    const r = await probeIdentity(identity, { adb: okAdb({ versionName: async () => '449.0.0.1.1' }), mcp: okMcp });
    expect(r.ready).toBe(false);
    expect(r.signals.versionMatch).toBe(false);
    expect(r.failureClass).toBe('version');
    expect(r.details.join(' ')).toContain('449.0.0.1.1');
  });
  it('tool faltando → toolsPresent falso, mesmo com 56 outras', async () => {
    const mcp = async () => ({ tools: async () => ({ android_conta1_get_screen_state: {} }) as never, close: async () => {} });
    const r = await probeIdentity(identity, { adb: okAdb(), mcp });
    expect(r.signals.toolsPresent).toBe(false);
    expect(r.details.some((d) => d.includes('android_conta1_press_back'))).toBe(true);
  });
  it('device sumiu → tudo falso, classe infra, sem lançar', async () => {
    const adb = okAdb({ getprop: async () => { throw new AdbError('device-missing', "device 'emulator-5554' not found"); } });
    const r = await probeIdentity(identity, { adb, mcp: okMcp });
    expect(r.ready).toBe(false);
    expect(r.failureClass).toBe('infra');
  });
});
