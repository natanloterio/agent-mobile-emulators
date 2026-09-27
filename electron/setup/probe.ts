import { access, constants, readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { sizesFor } from './artifacts.js';
import { execOrNull, readHardware, type HardwareDeps } from './hardware.js';
import type { SetupPaths } from './paths.js';
import type { PlatformId } from './platform.js';
import type { DepId, DepStatus, SetupReport, UserFix } from './types.js';

export interface ProbeDeps {
  readonly exists: (p: string) => Promise<boolean>;
  readonly canReadWrite: (p: string) => Promise<boolean>;
  readonly readText: (p: string) => Promise<string | null>;
  /** stdout+stderr, ou null se o comando não existe ou falhou. */
  readonly exec: (cmd: string, args: readonly string[]) => Promise<string | null>;
  readonly listDir: (p: string) => Promise<readonly string[]>;
  readonly keyringOk: () => Promise<boolean>;
}
export interface ProbeResult { readonly report: SetupReport; readonly ollamaBin: string | null }

export const parseSourceProperties = (text: string): string | null => /^Pkg\.Revision=(.+)$/m.exec(text)?.[1].trim() ?? null;
/** Versão maior do `java -version` ("17.0.12", "21", ou o antigo "1.8.0_392" = 8). */
export function javaMajor(out: string | null): number | null {
  const m = /version "(\d+)(?:\.(\d+))?/.exec(out ?? '');
  if (!m) return null;
  const first = Number(m[1]);
  return first === 1 && m[2] ? Number(m[2]) : first;
}
/** Java mínimo das cmdline-tools atuais; o JRE do Enxame (Temurin 17) atende. */
export const MIN_JAVA = 17;

export const parseOllamaVersion = (out: string | null): string | null => /(\d+\.\d+\.\d+)/.exec(out ?? '')?.[1] ?? null;

/** No Windows os caminhos usam `\`; nas demais plataformas, `/`. */
const pathFor = (platform: PlatformId): typeof path.posix => (platform === 'win32-x64' ? path.win32 : path.posix);

const ok = (id: DepId, version: string | null): DepStatus => ({ id, state: 'ok', version, sizeMb: null, fix: null });
const todo = (id: keyof ReturnType<typeof sizesFor>, paths: SetupPaths): DepStatus =>
  ({ id: id as DepId, state: 'todo', version: null, sizeMb: sizesFor(paths.platform)[id], fix: null });
const user = (id: DepId, fix: UserFix): DepStatus => ({ id, state: 'user', version: null, sizeMb: null, fix });

async function sdkPackage(id: 'sdk' | 'adb' | 'emu' | 'img', bin: string, dir: string, paths: SetupPaths, d: ProbeDeps): Promise<DepStatus> {
  const p = pathFor(paths.platform);
  if (!(await d.exists(bin))) return todo(id, paths);
  return ok(id, parseSourceProperties((await d.readText(p.join(dir, 'source.properties'))) ?? '') ?? '?');
}

/** sdkmanager presente não basta: ele precisa do JRE do Enxame ou de um Java ≥ 17 no PATH. */
async function probeSdkTools(paths: SetupPaths, d: ProbeDeps): Promise<DepStatus> {
  const p = pathFor(paths.platform);
  const dir = p.dirname(p.dirname(paths.sdkmanager));
  const s = await sdkPackage('sdk', paths.sdkmanager, dir, paths, d);
  if (s.state !== 'ok' || (await d.exists(paths.javaBin))) return s;
  const major = javaMajor(await d.exec('java', ['-version']));
  return major !== null && major >= MIN_JAVA ? s : { ...todo('sdk', paths), sizeMb: sizesFor(paths.platform).jreOnly };
}

/** Consulta sem admin: 1 = recurso ligado. */
export const WHPX_QUERY = "(Get-CimInstance Win32_OptionalFeature -Filter \"Name='HypervisorPlatform'\").InstallState";

/** Aceleração do emulador pelo próprio sistema (o emulador pode ainda não estar instalado). */
async function probeAccel(platform: PlatformId, d: ProbeDeps): Promise<DepStatus> {
  if (platform.startsWith('darwin')) {
    return (await d.exec('sysctl', ['-n', 'kern.hv_support']))?.trim() === '1' ? ok('kvm', 'Hypervisor.framework') : user('kvm', 'hvf-off');
  }
  if (platform === 'win32-x64') {
    return (await d.exec('powershell', ['-NoProfile', '-Command', WHPX_QUERY]))?.trim() === '1' ? ok('kvm', 'WHPX') : user('kvm', 'whpx-off');
  }
  if (!(await d.exists('/dev/kvm'))) return user('kvm', 'kvm-bios');
  return (await d.canReadWrite('/dev/kvm')) ? ok('kvm', '/dev/kvm') : user('kvm', 'kvm-group');
}

/** O Ollama instalado pelo Enxame vem primeiro; senão o do PATH. */
async function findOllama(paths: SetupPaths, d: ProbeDeps): Promise<{ bin: string; version: string } | null> {
  for (const bin of [paths.ollamaBin, 'ollama']) {
    const version = parseOllamaVersion(await d.exec(bin, ['--version']));
    if (version) return { bin, version };
  }
  return null;
}

/** Manifestos em `<models>/manifests/registry.ollama.ai/library/<nome>/<tag>` (não precisa do servidor no ar). */
export async function listLocalModels(modelsDir: string, d: Pick<ProbeDeps, 'listDir'>): Promise<readonly string[]> {
  const lib = path.join(modelsDir, 'manifests', 'registry.ollama.ai', 'library');
  const names = await d.listDir(lib);
  const perName = await Promise.all(names.map(async (n) => (await d.listDir(path.join(lib, n))).map((tag) => `${n}:${tag}`)));
  return perName.flat().sort();
}

export async function probeDeps(paths: SetupPaths, d: ProbeDeps): Promise<{ deps: readonly DepStatus[]; ollamaBin: string | null; localModels: readonly string[] }> {
  const p = pathFor(paths.platform);
  const [sdkS, adb, emu, sysImg, kvm, ollama, keyringOk, localModels] = await Promise.all([
    probeSdkTools(paths, d),
    sdkPackage('adb', paths.adbBin, p.dirname(paths.adbBin), paths, d),
    sdkPackage('emu', paths.emulatorBin, p.dirname(paths.emulatorBin), paths, d),
    sdkPackage('img', p.join(paths.imageDir, 'system.img'), paths.imageDir, paths, d),
    probeAccel(paths.platform, d),
    findOllama(paths, d),
    d.keyringOk(),
    listLocalModels(paths.ollamaModels, d),
  ]);
  const deps = [
    sdkS, adb, emu, sysImg, kvm,
    ollama ? ok('ollama', ollama.version) : todo('ollama', paths),
    keyringOk ? ok('keyring', null) : user('keyring', 'keyring-locked'),
  ];
  return { deps, ollamaBin: ollama?.bin ?? null, localModels };
}

export async function probeSetup(paths: SetupPaths, d: ProbeDeps, hw: HardwareDeps): Promise<ProbeResult> {
  const home = path.dirname(path.dirname(paths.ollamaModels)) || '/';
  const [p, hardware] = await Promise.all([probeDeps(paths, d), readHardware(home, hw, paths.platform)]);
  return { report: { deps: p.deps, hardware, localModels: p.localModels }, ollamaBin: p.ollamaBin };
}

/** Mesma entrada que o cofre do daemon usa (daemon/src/vault/keyring.ts), com outra conta: só testa se o Secret Service responde. */
function keyringProbe(): boolean {
  try {
    const { Entry } = createRequire(import.meta.url)('@napi-rs/keyring') as typeof import('@napi-rs/keyring');
    new Entry('enxame', 'setup-probe', { linux: { store: 'secret-service' } }).getPassword();
    return true;
  } catch { return false; }
}

export function nodeProbeDeps(): ProbeDeps {
  return {
    exists: (p) => access(p).then(() => true, () => false),
    canReadWrite: (p) => access(p, constants.R_OK | constants.W_OK).then(() => true, () => false),
    readText: (p) => readFile(p, 'utf8').catch(() => null),
    exec: execOrNull,
    listDir: (p) => readdir(p).catch(() => []),
    keyringOk: async () => keyringProbe(),
  };
}
