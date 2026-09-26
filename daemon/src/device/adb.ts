import { execFile, spawn as nodeSpawn } from 'node:child_process';
import { CONFIG } from '../config.js';
import type { ChildLike } from '../provider/ollama.js';

export type { ChildLike };
export type Exec = (file: string, args: readonly string[], env: NodeJS.ProcessEnv) => Promise<{ stdout: string; stderr: string; code: number }>;
export type ExecBuffer = (file: string, args: readonly string[], env: NodeJS.ProcessEnv) => Promise<{ stdout: Buffer; stderr: string; code: number }>;
export type Spawn = (file: string, args: readonly string[], opts: { env: NodeJS.ProcessEnv }) => ChildLike;

export class AdbError extends Error {
  constructor(readonly kind: 'device-missing' | 'command', message: string) { super(message); this.name = 'AdbError'; }
}

const defaultExec: Exec = (file, args, env) =>
  new Promise((resolve) => {
    execFile(file, [...args], { env, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err && typeof (err as NodeJS.ErrnoException & { code?: number }).code === 'number' ? Number((err as { code?: number }).code) : err ? 1 : 0;
      resolve({ stdout: String(stdout), stderr: String(stderr), code });
    });
  });

const defaultExecBuffer: ExecBuffer = (file, args, env) =>
  new Promise((resolve) => {
    // timeout: 5000 and killSignal: 'SIGKILL' ensure a hung adb becomes a failed capture (non-zero code → AdbError),
    // never a hung loop.
    execFile(file, [...args], { env, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024, timeout: 5000, killSignal: 'SIGKILL' }, (err, stdout, stderr) => {
      const code = err && typeof (err as NodeJS.ErrnoException & { code?: number }).code === 'number' ? Number((err as { code?: number }).code) : err ? 1 : 0;
      resolve({ stdout: Buffer.from(stdout), stderr: String(stderr), code });
    });
  });

const MCP_PKG = CONFIG.mcpAppPackage;
const CONFIGURE_ACTION = 'com.danielealbano.androidremotecontrolmcp.ADB_CONFIGURE';
const CONFIGURE_RECEIVER = 'com.danielealbano.androidremotecontrolmcp.services.mcp.AdbConfigReceiver';
const TRAMPOLINE = 'com.danielealbano.androidremotecontrolmcp.services.mcp.AdbServiceTrampolineActivity';

function extraArgs(extras: Record<string, string | number | boolean>): readonly string[] {
  return Object.entries(extras).flatMap(([k, v]) =>
    typeof v === 'boolean' ? ['--ez', k, String(v)] : typeof v === 'number' ? ['--ei', k, String(v)] : ['--es', k, v]);
}

export interface Adb {
  devices(): Promise<readonly string[]>;
  getprop(serial: string, key: string): Promise<string>;
  settingsGetSecure(serial: string, key: string): Promise<string>;
  versionName(serial: string, pkg: string): Promise<string | null>;
  push(serial: string, local: string, remote: string): Promise<void>;
  forward(serial: string, hostPort: number, spec: string): Promise<void>;
  forwardRemove(serial: string, hostPort: number): Promise<void>;
  shellSpawn(serial: string, cmd: readonly string[]): ChildLike;
  /** `adb shell` genérico; os argumentos são juntados com espaço e interpretados pelo `sh` do device — quem chama escapa. */
  shell(serial: string, cmd: readonly string[]): Promise<string>;
  broadcastConfigure(serial: string, extras: Record<string, string | number | boolean>): Promise<void>;
  startTrampoline(serial: string, action: 'start' | 'stop'): Promise<void>;
  screencap(serial: string): Promise<Buffer>;
}

export function createAdb(deps: { exec?: Exec; execBuffer?: ExecBuffer; spawn?: Spawn; adbPath?: string; serverPort?: number } = {}): Adb {
  const exec = deps.exec ?? defaultExec;
  const execBuffer = deps.execBuffer ?? defaultExecBuffer;
  const spawnFn = deps.spawn ?? ((file, args, opts) => nodeSpawn(file, [...args], { env: opts.env, stdio: ['ignore', 'pipe', 'pipe'] }) as unknown as ChildLike);
  const adbPath = deps.adbPath ?? CONFIG.adbPath;
  const env = { ...process.env, ANDROID_ADB_SERVER_PORT: String(deps.serverPort ?? CONFIG.adbServerPort) };

  async function run(args: readonly string[]): Promise<string> {
    const r = await exec(adbPath, args, env);
    if (r.code !== 0) {
      const msg = (r.stderr || r.stdout).trim();
      throw new AdbError(/not found|offline|no devices/i.test(msg) ? 'device-missing' : 'command', msg || `adb ${args.join(' ')} falhou`);
    }
    return r.stdout.replace(/\r/g, '').trim();
  }

  async function runBuffer(args: readonly string[]): Promise<Buffer> {
    const r = await execBuffer(adbPath, args, env);
    if (r.code !== 0) {
      const msg = r.stderr.trim();
      throw new AdbError(/not found|offline|no devices/i.test(msg) ? 'device-missing' : 'command', msg || `adb ${args.join(' ')} falhou`);
    }
    return r.stdout;
  }

  const shell = (serial: string, cmd: readonly string[]) => run(['-s', serial, 'shell', ...cmd]);

  return {
    devices: async () => (await run(['devices'])).split('\n').slice(1).filter((l) => l.endsWith('\tdevice')).map((l) => l.split('\t')[0]),
    getprop: (serial, key) => shell(serial, ['getprop', key]),
    settingsGetSecure: (serial, key) => shell(serial, ['settings', 'get', 'secure', key]),
    versionName: async (serial, pkg) => /versionName=(\S+)/.exec(await shell(serial, ['dumpsys', 'package', pkg]))?.[1] ?? null,
    push: async (serial, local, remote) => { await run(['-s', serial, 'push', local, remote]); },
    forward: async (serial, hostPort, spec) => { await run(['-s', serial, 'forward', `tcp:${hostPort}`, spec]); },
    forwardRemove: async (serial, hostPort) => { await run(['-s', serial, 'forward', '--remove', `tcp:${hostPort}`]); },
    shellSpawn: (serial, cmd) => spawnFn(adbPath, ['-s', serial, 'shell', ...cmd], { env }),
    shell,
    broadcastConfigure: async (serial, extras) => {
      await shell(serial, ['am', 'broadcast', '-a', CONFIGURE_ACTION, '-n', `${MCP_PKG}/${CONFIGURE_RECEIVER}`, ...extraArgs(extras)]);
    },
    startTrampoline: async (serial, action) => { await shell(serial, ['am', 'start', '-n', `${MCP_PKG}/${TRAMPOLINE}`, '--es', 'action', action]); },
    screencap: (serial) => runBuffer(['-s', serial, 'exec-out', 'screencap', '-p']),
  };
}
