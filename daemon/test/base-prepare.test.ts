import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { readBasePrep, readTargetVersion } from '../src/db/base-settings.js';
import type { IdentityRow } from '../src/db/identities.js';
import type { MissionRow } from '../src/db/missions.js';
import { createBasePreparer, type PrepareDeps } from '../src/base/prepare.js';

const id = { id: 'base', serial: 'emulator-5554' } as IdentityRow;
const mission = (state: MissionRow['state'], humanReason: string | null = null) => ({ id: 'm1', state, humanReason }) as MissionRow;

function harness(o: { exists?: boolean; installedAfter?: number; email?: string | null; states?: MissionRow['state'][]; googleLeft?: number } = {}) {
  const db = openDb(':memory:');
  const log: string[] = [];
  let versionCalls = 0;
  let googleCalls = 0;
  const states = [...(o.states ?? ['running', 'done'])];
  const d: PrepareDeps = {
    db, onChange: () => undefined, sleep: async () => undefined,
    baseExists: () => o.exists ?? false,
    createAvd: async () => { log.push('avd'); },
    baseIdentity: async () => id,
    boot: async (i) => { log.push('boot'); return i; },
    setupMcp: async () => { log.push('mcp'); },
    targetVersion: async () => (++versionCalls > (o.installedAfter ?? 1) ? '450.0' : null),
    // Conta Google no aparelho nas primeiras `googleLeft` consultas (padrão: nenhuma).
    googleOnDevice: async () => ++googleCalls <= (o.googleLeft ?? 0),
    googleEmail: async () => (o.email === undefined ? 'eu@gmail.com' : o.email),
    startMission: () => { log.push('mission'); return 'm1'; },
    mission: () => mission(states.length > 1 ? states.shift()! : states[0]),
    endMission: (mid) => { log.push(`end ${mid}`); },
    // Remoção determinística: tira a conta de vez (as próximas consultas já não a acham).
    removeGoogle: async () => { log.push('remove-google'); googleCalls = Number.MAX_SAFE_INTEGER - 1; },
    finish: async () => { log.push('finish'); },
  };
  return { db, log, d };
}

describe('createBasePreparer', () => {
  it('do zero: cria o AVD, sobe, instala o MCP, roda a missão, grava a versão e desliga', async () => {
    const h = harness();
    await createBasePreparer(h.d).start();
    expect(h.log).toEqual(['avd', 'boot', 'mcp', 'mission', 'finish']);
    expect(readBasePrep(h.db).state).toBe('done');
    expect(readTargetVersion(h.db)).toBe('450.0');
  });
  it('pula o que já está feito: AVD existente e app já instalado não abrem missão', async () => {
    const h = harness({ exists: true, installedAfter: 0 });
    await createBasePreparer(h.d).start();
    expect(h.log).toEqual(['boot', 'mcp', 'finish']);
  });
  it('sem conta Google: para em needs-google, sem missão; com a conta, retoma e termina', async () => {
    const h = harness({ email: null });
    await createBasePreparer(h.d).start();
    expect(readBasePrep(h.db)).toMatchObject({ state: 'needs-google', phase: 'google' });
    expect(h.log).not.toContain('mission');
    const again = harness({ exists: true });
    await createBasePreparer({ ...again.d, db: h.db }).start();
    expect(readBasePrep(h.db).state).toBe('done');
  });
  it('verificação do Google: vira needs-human com o motivo e volta quando a missão segue', async () => {
    const h = harness({ states: ['awaiting-human', 'awaiting-human', 'running', 'done'] });
    const seen: string[] = [];
    const d = { ...h.d, onChange: () => { seen.push(readBasePrep(h.db).state); } };
    await createBasePreparer(d).start();
    expect(seen).toContain('needs-human');
    expect(readBasePrep(h.db).state).toBe('done');
  });
  it('missão acabou sem o app: falha com motivo, e dá para tentar de novo', async () => {
    const h = harness({ installedAfter: 99 });
    await createBasePreparer(h.d).start();
    expect(readBasePrep(h.db)).toMatchObject({ state: 'failed', error: 'a missão terminou sem o app instalado' });
  });
  it('app instalado mas conta Google no aparelho: remove pelas Configurações, sem missão', async () => {
    const h = harness({ exists: true, installedAfter: 0, googleLeft: 1 });
    await createBasePreparer(h.d).start();
    expect(h.log).toEqual(['boot', 'mcp', 'remove-google', 'finish']);
    expect(readBasePrep(h.db).state).toBe('done');
  });
  it('remoção não tirou a conta: falha sem desligar a base (clones herdariam a conta)', async () => {
    const h = harness({ exists: true, installedAfter: 0, googleLeft: 99 });
    await createBasePreparer({ ...h.d, removeGoogle: async () => { h.log.push('remove-google'); } }).start();
    expect(readBasePrep(h.db)).toMatchObject({ state: 'failed', error: 'a conta Google continua no celular-base' });
    expect(h.log).not.toContain('finish');
  });
  it('app apareceu no aparelho com a missão ainda rodando: encerra a missão sozinho e segue (não espera o modelo perceber)', async () => {
    const h = harness({ installedAfter: 2, states: ['running'] });
    await createBasePreparer(h.d).start();
    expect(h.log).toEqual(['avd', 'boot', 'mcp', 'mission', 'end m1', 'finish']);
    expect(readBasePrep(h.db).state).toBe('done');
  });
  it('erro numa fase fica gravado com a fase', async () => {
    const h = harness();
    await createBasePreparer({ ...h.d, boot: async () => { throw new Error('emulador não subiu'); } }).start();
    expect(readBasePrep(h.db)).toMatchObject({ state: 'failed', phase: 'boot', error: 'emulador não subiu' });
  });
  it('duas chamadas ao mesmo tempo rodam um preparo só', async () => {
    const h = harness();
    const p = createBasePreparer(h.d);
    await Promise.all([p.start(), p.start()]);
    expect(h.log.filter((l) => l === 'boot')).toHaveLength(1);
  });
});
