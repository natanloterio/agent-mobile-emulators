import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { BASE_IDENTITY_ID, listFleet, listIdentities, upsertIdentity } from '../src/db/identities.js';
import { buildSnapshot } from '../src/server/snapshot.js';
import { candidateIdentities } from '../src/leader/readiness.js';

const row = (id: string, consolePort: number) => ({
  id, name: id, handle: '', avdName: `avd_${id}`, serial: `emulator-${consolePort}`, consolePort, mcpHostPort: consolePort + 3000,
  mcpToken: 't', deviceSlug: id, appPackage: 'com.instagram.android', appVersionName: '1', state: 'idle' as const,
});

describe('identidade reservada do celular-base', () => {
  it('fica no banco (segura as portas) mas fora da frota: snapshot, candidatas a objetivo e listFleet', () => {
    const db = openDb(':memory:');
    upsertIdentity(db, row('conta1', 5554)); upsertIdentity(db, row(BASE_IDENTITY_ID, 5556));
    expect(listIdentities(db).map((i) => i.id)).toEqual(['base', 'conta1']);
    expect(listFleet(db).map((i) => i.id)).toEqual(['conta1']);
    expect(buildSnapshot(db, false).identities.map((i) => i.id)).toEqual(['conta1']);
    expect(candidateIdentities(db).map((i) => i.id)).toEqual(['conta1']);
  });
});

describe('rotas da frota não enxergam a identidade do celular-base', () => {
  it('getFleetIdentity devolve null para "base"', async () => {
    const { getFleetIdentity } = await import('../src/db/identities.js');
    const db = openDb(':memory:');
    upsertIdentity(db, row(BASE_IDENTITY_ID, 5556)); upsertIdentity(db, row('conta1', 5554));
    expect(getFleetIdentity(db, 'base')).toBeNull();
    expect(getFleetIdentity(db, 'conta1')?.id).toBe('conta1');
  });
});

describe('identidade de verdade chamada "base"', () => {
  it('continua na frota (AVD tapflock_base): só a linha do preparo some', async () => {
    const { getFleetIdentity } = await import('../src/db/identities.js');
    const db = openDb(':memory:');
    upsertIdentity(db, { ...row(BASE_IDENTITY_ID, 5556), avdName: 'tapflock_base' });
    expect(listFleet(db).map((i) => i.id)).toEqual(['base']);
    expect(getFleetIdentity(db, 'base')?.avdName).toBe('tapflock_base');
  });
});
