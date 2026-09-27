import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { getIdentity, upsertIdentity, type IdentityRow } from '../src/db/identities.js';
import type { ChildLike } from '../src/device/adb.js';
import { bootEmulator, createEmulatorSupervisor, emulatorArgs, killEmulator, killProcessTree, loadSnapshot, saveSnapshot } from '../src/fleet/emulator.js';

const row: IdentityRow = { id: 'conta2', name: 'conta2', handle: 'sem conta', avdName: 'enxame_conta2', serial: 'emulator-5556', consolePort: 5556, mcpHostPort: 8081, mcpToken: 't', deviceSlug: 'conta2', appPackage: 'p', appVersionName: 'v', state: 'provisioned' };

function fakeChild(pid = 777) {
  const handlers: Record<string, ((e?: Error) => void)[]> = {};
  const kills: string[] = [];
  const child: ChildLike = { pid, kill: (s) => { kills.push(String(s)); return true; }, on: (ev, cb) => { (handlers[ev] ??= []).push(cb); return child; } };
  return { child, kills, exit: () => handlers.exit?.forEach((h) => h()) };
}

function supHarness() {
  const spawned: { file: string; args: readonly string[]; env: NodeJS.ProcessEnv; detached: boolean }[] = [];
  const groupKills: { pid: number; sig: string }[] = [];
  const kids: ReturnType<typeof fakeChild>[] = [];
  const sup = createEmulatorSupervisor({
    emulatorPath: '/sdk/emulator/emulator', avdHome: '/avd', adbServerPort: 5038, openLog: () => 'ignore', closeLog: () => {},
    spawn: (file, args, opts) => { spawned.push({ file, args, env: opts.env, detached: opts.detached }); const k = fakeChild(700 + kids.length); kids.push(k); return k.child; },
    killGroup: (pid, sig) => { groupKills.push({ pid, sig }); },
  });
  return { sup, spawned, groupKills, kids };
}

describe('emulador', () => {
  it('argumentos do spec: -avd -port -no-audio -no-boot-anim e -no-window sem janela', () => {
    expect(emulatorArgs('a', 5556, false)).toEqual(['-avd', 'a', '-port', '5556', '-no-audio', '-no-boot-anim', '-no-window']);
    expect(emulatorArgs('a', 5556, true)).toEqual(['-avd', 'a', '-port', '5556', '-no-audio', '-no-boot-anim']);
  });

  it('supervisor: spawna destacado com ANDROID_ADB_SERVER_PORT e ANDROID_AVD_HOME; stopAll só mata os seus', () => {
    const h = supHarness();
    h.sup.launch('conta2', 'enxame_conta2', 5556, false);
    h.sup.launch('conta2', 'enxame_conta2', 5556, false); // idempotente enquanto vivo
    expect(h.spawned).toHaveLength(1);
    expect(h.spawned[0]).toMatchObject({ file: '/sdk/emulator/emulator', detached: true });
    expect(h.spawned[0].env).toMatchObject({ ANDROID_ADB_SERVER_PORT: '5038', ANDROID_AVD_HOME: '/avd' });
    expect(h.sup.has('conta2')).toBe(true);
    h.sup.launch('conta3', 'enxame_conta3', 5558, true);
    h.kids[1].exit(); // conta3 morreu sozinho: sai do supervisor
    expect(h.sup.owned()).toEqual(['conta2']);
    h.sup.stopAll();
    expect(h.groupKills).toEqual([{ pid: 700, sig: 'SIGTERM' }]);
    expect(h.sup.owned()).toEqual([]);
  });

  it('sem spawn injetado, recusa rodar sob vitest', () => {
    const sup = createEmulatorSupervisor({ openLog: () => 'ignore' });
    expect(() => sup.launch('x', 'x', 5556, false)).toThrow(/vitest/);
  });

  it('boot: serial já no adb → não spawna nada', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const h = supHarness();
    const out = await bootEmulator(db, row, { window: false }, { adb: { devices: async () => ['emulator-5556'], getprop: async () => '1' }, supervisor: h.sup, isPortFree: async () => false, sleep: async () => {} });
    expect(out).toEqual(row); expect(h.spawned).toHaveLength(0);
  });

  it('boot: porta livre → spawna e espera sys.boot_completed=1', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const h = supHarness(); let polls = 0;
    const adb = { devices: async () => [], getprop: async (s: string, k: string) => { expect([s, k]).toEqual(['emulator-5556', 'sys.boot_completed']); polls += 1; if (polls < 3) throw new Error('device offline'); return polls < 4 ? '' : '1'; } };
    const out = await bootEmulator(db, row, { window: true }, { adb, supervisor: h.sup, isPortFree: async () => true, sleep: async () => {} });
    expect(out.serial).toBe('emulator-5556');
    expect(h.spawned[0].args).toEqual(emulatorArgs('enxame_conta2', 5556, true));
    expect(polls).toBe(4);
  });

  it('boot: porta presa → lease novo, grava console/serial/mcp no banco e sobe na porta nova', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const h = supHarness();
    const out = await bootEmulator(db, row, { window: false }, {
      adb: { devices: async () => [], getprop: async () => '1' }, supervisor: h.sup, sleep: async () => {},
      isPortFree: async (p) => p !== 5556, leasePorts: async () => ({ consolePort: 5560, mcpHostPort: 8085 }),
    });
    expect(out).toMatchObject({ consolePort: 5560, serial: 'emulator-5560', mcpHostPort: 8085 });
    expect(getIdentity(db, 'conta2')).toMatchObject({ consolePort: 5560, serial: 'emulator-5560', mcpHostPort: 8085, state: 'provisioned', mcpToken: 't' });
    expect(h.spawned[0].args).toContain('5560');
  });

  it('boot: processo sai antes do boot → erro com o log; timeout → mata o nosso e lança', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const h = supHarness();
    let t = 0;
    const dying = bootEmulator(db, row, { window: false }, {
      adb: { devices: async () => [], getprop: async () => '' }, supervisor: h.sup, isPortFree: async () => true,
      sleep: async () => { t += 1000; if (t === 2000) h.kids[0].exit(); }, now: () => t, bootTimeoutMs: 60_000,
    });
    await expect(dying).rejects.toThrow(/saiu antes do boot/);
    const h2 = supHarness(); let t2 = 0;
    const slow = bootEmulator(db, row, { window: false }, {
      adb: { devices: async () => [], getprop: async () => '0' }, supervisor: h2.sup, isPortFree: async () => true,
      sleep: async () => { t2 += 1000; }, now: () => t2, bootTimeoutMs: 5000,
    });
    await expect(slow).rejects.toThrow(/não completou o boot em 5 s/);
    expect(h2.groupKills).toEqual([{ pid: 700, sig: 'SIGTERM' }]);
    expect(h2.sup.owned()).toEqual([]);
  });

  it('snapshot save/load e kill pelo console do emulador', async () => {
    const calls: string[] = []; let gone = 0;
    const adb = {
      emu: async (s: string, a: readonly string[]) => { calls.push(`${s} ${a.join(' ')}`); return 'OK'; },
      devices: async () => { gone += 1; return gone < 3 ? ['emulator-5556'] : []; },
    };
    await saveSnapshot(adb, 'emulator-5556', 'enxame');
    await loadSnapshot(adb, 'emulator-5556', 'enxame');
    await killEmulator(adb, 'emulator-5556', { sleep: async () => {} });
    expect(calls).toEqual(['emulator-5556 avd snapshot save enxame', 'emulator-5556 avd snapshot load enxame', 'emulator-5556 kill']);
    expect(gone).toBe(3);
  });

  it('kill que não derruba o device no prazo → erro', async () => {
    let t = 0;
    const adb = { emu: async () => 'OK', devices: async () => ['emulator-5556'] };
    await expect(killEmulator(adb, 'emulator-5556', { sleep: async () => { t += 1000; }, now: () => t, timeoutMs: 3000 })).rejects.toThrow(/continua no adb/);
  });
});

describe('killProcessTree — emulator + qemu por SO', () => {
  const harness = (platform: NodeJS.Platform, failGroup = false) => {
    const kills: [number, string][] = []; const runs: string[][] = [];
    const deps = {
      platform,
      kill: (pid: number, sig: NodeJS.Signals) => { if (failGroup && pid < 0) throw new Error('ESRCH'); kills.push([pid, sig]); },
      run: (file: string, args: readonly string[]) => { runs.push([file, ...args]); },
    };
    return { deps, kills, runs };
  };
  it('Linux/macOS: sinal no grupo (pid negativo)', () => {
    for (const platform of ['linux', 'darwin'] as const) {
      const h = harness(platform);
      killProcessTree(42, 'SIGTERM', h.deps);
      expect(h.kills).toEqual([[-42, 'SIGTERM']]); expect(h.runs).toEqual([]);
    }
  });
  it('grupo já morto: tenta o pid direto', () => {
    const h = harness('linux', true);
    killProcessTree(42, 'SIGTERM', h.deps);
    expect(h.kills).toEqual([[42, 'SIGTERM']]);
  });
  it('Windows: taskkill /T /F derruba a árvore (não existe grupo de processos)', () => {
    const h = harness('win32');
    killProcessTree(42, 'SIGTERM', h.deps);
    expect(h.runs).toEqual([['taskkill', '/PID', '42', '/T', '/F']]); expect(h.kills).toEqual([]);
  });
});
