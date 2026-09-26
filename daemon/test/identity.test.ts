import { describe, expect, it } from 'vitest';
import type { Adb } from '../src/device/adb.js';
import { openDb } from '../src/db/open.js';
import { getIdentity, upsertIdentity } from '../src/db/identities.js';
import { ensureIdentityReady } from '../src/fleet/identity.js';

const row = { id: 'conta1', name: 'conta1', handle: '@a', avdName: 'x', serial: 'emulator-5554', consolePort: 5554, mcpHostPort: 8080, mcpToken: 'tok', deviceSlug: 'conta1', appPackage: 'com.instagram.android', appVersionName: '448.0.0.52.84', state: 'logged-in' as const };
const adbSpy = () => {
  const calls: string[] = [];
  const adb: Adb = {
    devices: async () => ['emulator-5554'], getprop: async () => '1', settingsGetSecure: async () => '', versionName: async () => '448.0.0.52.84',
    forward: async (s, h, d) => { calls.push(`forward ${s} ${h} ${d}`); },
    broadcastConfigure: async (_s, e) => { calls.push(`configure ${Object.keys(e).sort().join(',')}`); },
    startTrampoline: async (_s, a) => { calls.push(`trampoline ${a}`); },
  };
  return { adb, calls };
};
const readyProbe = async () => ({ ready: true, signals: { bootCompleted: true, accessibility: true, mcpInitialize: true, toolsPresent: true, versionMatch: true }, details: [], failureClass: null });
const versionProbe = async () => ({ ready: false, signals: { bootCompleted: true, accessibility: true, mcpInitialize: true, toolsPresent: true, versionMatch: false }, details: ['versionName 449 ≠ 448'], failureClass: 'version' as const });

describe('ensureIdentityReady', () => {
  it('refaz forward, aplica slug e token por broadcast e marca idle quando pronta', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const { adb, calls } = adbSpy();
    const r = await ensureIdentityReady(db, row, { adb, probe: readyProbe });
    expect(r.ready).toBe(true);
    expect(calls).toContain('forward emulator-5554 8080 8080');
    expect(calls).toContain('configure bearer_token,bearer_token_enabled,device_slug');
    expect(getIdentity(db, 'conta1')?.state).toBe('idle');
  });
  it('versão divergente → offline com last_error, sem lançar', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const r = await ensureIdentityReady(db, row, { adb: adbSpy().adb, probe: versionProbe });
    expect(r.ready).toBe(false);
    const got = getIdentity(db, 'conta1');
    expect(got?.state).toBe('offline');
    expect(got?.lastError).toContain('449');
  });
});
