import { execFile, spawn as nodeSpawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { CONFIG } from '../config.js';
import { getIdentity, upsertIdentity, type IdentityRow } from '../db/identities.js';
import type { Adb, ChildLike } from '../device/adb.js';
import { isPortFree as realIsPortFree, leasePorts as realLeasePorts } from './ports.js';

/** Boot do AVD da identidade (spec inc. 5 §2; spec principal §4.1 "Alocação de portas"). */
export const emulatorArgs = (avd: string, consolePort: number, window: boolean): readonly string[] =>
  ['-avd', avd, '-port', String(consolePort), '-no-audio', '-no-boot-anim', ...(window ? [] : ['-no-window'])];

export type EmulatorSpawn = (file: string, args: readonly string[], opts: { env: NodeJS.ProcessEnv; detached: boolean; stdio: unknown }) => ChildLike;
export interface EmulatorSupervisorDeps {
  readonly spawn?: EmulatorSpawn;
  readonly emulatorPath?: string; readonly avdHome?: string; readonly adbServerPort?: number; readonly logDir?: string;
  readonly openLog?: (p: string) => unknown; readonly closeLog?: (fd: unknown) => void;
  /** Mata a árvore do processo destacado (emulator + qemu); ver `killProcessTree`. */
  readonly killGroup?: (pid: number, sig: NodeJS.Signals) => void;
}
/** Só os emuladores que o daemon subiu: `stopAll` nunca toca em emulador aberto por outra pessoa (ex.: o da conta1). */
export interface EmulatorSupervisor {
  launch(id: string, avd: string, consolePort: number, window: boolean): ChildLike;
  has(id: string): boolean;
  stop(id: string): void;
  stopAll(): void;
  owned(): readonly string[];
}

export interface KillTreeDeps {
  readonly platform?: NodeJS.Platform;
  readonly kill?: (pid: number, sig: NodeJS.Signals) => void;
  readonly run?: (file: string, args: readonly string[]) => void;
}

/**
 * Mata o emulador e o qemu que ele criou. POSIX: sinal no grupo do processo destacado. Windows não tem grupo e o
 * TerminateProcess mataria só o emulator.exe, deixando o qemu-system órfão com a RAM do device: `taskkill /T /F`.
 */
export function killProcessTree(pid: number, sig: NodeJS.Signals, deps: KillTreeDeps = {}): void {
  const kill = deps.kill ?? ((p: number, s: NodeJS.Signals) => { process.kill(p, s); });
  const run = deps.run ?? ((file: string, args: readonly string[]) => {
    execFile(file, [...args], { windowsHide: true }, (err) => { if (err) console.error(`[emulador] taskkill ${pid}: ${err.message}`); });
  });
  if ((deps.platform ?? process.platform) === 'win32') { run('taskkill', ['/PID', String(pid), '/T', '/F']); return; }
  try { kill(-pid, sig); } catch { try { kill(pid, sig); } catch { /* já morreu */ } }
}

const defaultKillGroup = (pid: number, sig: NodeJS.Signals) => killProcessTree(pid, sig);

export function createEmulatorSupervisor(deps: EmulatorSupervisorDeps = {}): EmulatorSupervisor {
  const spawnFn: EmulatorSpawn = deps.spawn ?? ((file, args, opts) =>
    nodeSpawn(file, [...args], { env: opts.env, detached: opts.detached, stdio: opts.stdio as never, windowsHide: true }) as unknown as ChildLike);
  const logDir = deps.logDir ?? CONFIG.dataDir;
  const openLog = deps.openLog ?? ((p: string) => { mkdirSync(path.dirname(p), { recursive: true }); return openSync(p, 'a'); });
  const closeLog = deps.closeLog ?? ((fd: unknown) => { try { closeSync(fd as number); } catch { /* já fechado */ } });
  const killGroup = deps.killGroup ?? defaultKillGroup;
  const live = new Map<string, ChildLike>();

  const stop = (id: string) => {
    const c = live.get(id);
    if (!c) return;
    live.delete(id);
    if (c.pid) killGroup(c.pid, 'SIGTERM'); else c.kill('SIGTERM');
  };

  return {
    has: (id) => live.has(id),
    owned: () => [...live.keys()],
    stop,
    stopAll: () => { for (const id of [...live.keys()]) stop(id); },
    launch: (id, avd, consolePort, window) => {
      const running = live.get(id);
      if (running) return running;
      if (!deps.spawn && process.env.VITEST) throw new Error('spawn do emulador desabilitado sob vitest (injete deps.spawn)');
      const env = {
        ...process.env,
        ANDROID_ADB_SERVER_PORT: String(deps.adbServerPort ?? CONFIG.adbServerPort),
        ANDROID_AVD_HOME: deps.avdHome ?? CONFIG.avd.home,
      };
      const log = openLog(path.join(logDir, `emulator-${avd}.log`));
      let child: ChildLike;
      try {
        child = spawnFn(deps.emulatorPath ?? CONFIG.avd.emulatorPath, emulatorArgs(avd, consolePort, window), { env, detached: true, stdio: ['ignore', log, log] });
      } catch (e) { closeLog(log); throw e; }
      // O filho herdou o descritor; o nosso pode fechar já.
      closeLog(log);
      const forget = () => { if (live.get(id) === child) live.delete(id); };
      child.on('exit', forget);
      child.on('error', forget);
      live.set(id, child);
      return child;
    },
  };
}

export interface BootDeps {
  readonly adb: Pick<Adb, 'devices' | 'getprop'>;
  readonly supervisor: EmulatorSupervisor;
  readonly isPortFree?: (port: number) => Promise<boolean>;
  readonly leasePorts?: (db: DatabaseSync) => Promise<{ consolePort: number; mcpHostPort: number }>;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  readonly bootTimeoutMs?: number;
  readonly pollMs?: number;
}

const serialOf = (consolePort: number) => `emulator-${consolePort}`;

/** Porta presa (TIME_WAIT, qemu zumbi): lease do próximo slot livre e registro atualizado — a porta é recurso alocado, não função do índice. */
async function ensurePorts(db: DatabaseSync, identity: IdentityRow, deps: BootDeps): Promise<IdentityRow> {
  const free = deps.isPortFree ?? realIsPortFree;
  if ((await free(identity.consolePort)) && (await free(identity.consolePort + 1))) return identity;
  const lease = await (deps.leasePorts ?? ((d) => realLeasePorts(d)))(db);
  const current = getIdentity(db, identity.id) ?? identity;
  const next: IdentityRow = { ...current, consolePort: lease.consolePort, mcpHostPort: lease.mcpHostPort, serial: serialOf(lease.consolePort) };
  upsertIdentity(db, next);
  return next;
}

/**
 * Sobe o emulador da identidade se o serial dela não estiver no adb e espera `sys.boot_completed=1`.
 * Devolve a identidade (com portas novas, se houve lease). Lança em saída prematura ou timeout (matando o que subiu).
 */
export async function bootEmulator(db: DatabaseSync, identity: IdentityRow, opts: { window: boolean }, deps: BootDeps): Promise<IdentityRow> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.bootTimeoutMs ?? CONFIG.avd.bootTimeoutMs;
  if ((await deps.adb.devices()).includes(serialOf(identity.consolePort))) return identity;
  const id = deps.supervisor.has(identity.id) ? identity : await ensurePorts(db, identity, deps);
  const serial = serialOf(id.consolePort);
  const child = deps.supervisor.launch(id.id, id.avdName, id.consolePort, opts.window);
  let exited = false;
  child.on('exit', () => { exited = true; });
  const t0 = now();
  for (;;) {
    if (exited) throw new Error(`emulador ${id.avdName} saiu antes do boot; veja ${path.join(CONFIG.dataDir, `emulator-${id.avdName}.log`)}`);
    const booted = await deps.adb.getprop(serial, 'sys.boot_completed').catch(() => '');
    if (booted === '1') return id;
    if (now() - t0 >= timeoutMs) {
      deps.supervisor.stop(id.id);
      throw new Error(`emulador ${id.avdName} não completou o boot em ${Math.round(timeoutMs / 1000)} s`);
    }
    await sleep(deps.pollMs ?? 2000);
  }
}

type EmuAdb = Pick<Adb, 'emu'>;
export const saveSnapshot = async (adb: EmuAdb, serial: string, name: string = CONFIG.avd.snapshotName) => { await adb.emu(serial, ['avd', 'snapshot', 'save', name]); };
export const loadSnapshot = async (adb: EmuAdb, serial: string, name: string = CONFIG.avd.snapshotName) => { await adb.emu(serial, ['avd', 'snapshot', 'load', name]); };

/** `adb emu kill` e espera o serial sumir do adb (apagar o AVD com o qemu vivo corromperia o descarte). */
export async function killEmulator(
  adb: Pick<Adb, 'emu' | 'devices'>, serial: string,
  opts: { sleep?: (ms: number) => Promise<void>; now?: () => number; timeoutMs?: number } = {},
): Promise<void> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  await adb.emu(serial, ['kill']);
  const t0 = now();
  while ((await adb.devices()).includes(serial)) {
    if (now() - t0 >= timeoutMs) throw new Error(`${serial} continua no adb ${Math.round(timeoutMs / 1000)} s depois do kill`);
    await sleep(1000);
  }
}
