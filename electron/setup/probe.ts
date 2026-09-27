import { access, constants, readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { execOrNull, readHardware, type HardwareDeps } from './hardware.js';
import type { SetupPaths } from './paths.js';
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

export const MIN_NODE = 24;
export const SYSTEM_IMAGE = 'system-images;android-34;google_apis_playstore;x86_64';
/** Download estimado de cada item (MB decimais): JRE 47 + cmdline-tools 181; Ollama v0.34.4 .tar.zst. */
export const SIZES_MB = { sdk: 228, adb: 14, emu: 380, img: 1600, ollama: 1428 } as const;

export const parseSourceProperties = (text: string): string | null => /^Pkg\.Revision=(.+)$/m.exec(text)?.[1].trim() ?? null;
export function nodeMajor(v: string | null): number | null {
  const m = /^v?(\d+)\./.exec(v?.trim() ?? '');
  return m ? Number(m[1]) : null;
}
/** Versão maior do `java -version` ("17.0.12", "21", ou o antigo "1.8.0_392" = 8). */
export function javaMajor(out: string | null): number | null {
  const m = /version "(\d+)(?:\.(\d+))?/.exec(out ?? '');
  if (!m) return null;
  const first = Number(m[1]);
  return first === 1 && m[2] ? Number(m[2]) : first;
}
/** Java mínimo das cmdline-tools atuais; o JRE do Enxame (Temurin 17) atende. */
export const MIN_JAVA = 17;
/** Só o JRE do Enxame (quando as cmdline-tools já estão lá). */
const JRE_ONLY_MB = 47;

export const parseOllamaVersion = (out: string | null): string | null => /(\d+\.\d+\.\d+)/.exec(out ?? '')?.[1] ?? null;

const ok = (id: DepId, version: string | null): DepStatus => ({ id, state: 'ok', version, sizeMb: null, fix: null });
const todo = (id: keyof typeof SIZES_MB): DepStatus => ({ id, state: 'todo', version: null, sizeMb: SIZES_MB[id], fix: null });
const user = (id: DepId, fix: UserFix): DepStatus => ({ id, state: 'user', version: null, sizeMb: null, fix });

async function sdkPackage(id: 'sdk' | 'adb' | 'emu' | 'img', bin: string, dir: string, d: ProbeDeps): Promise<DepStatus> {
  if (!(await d.exists(bin))) return todo(id);
  return ok(id, parseSourceProperties((await d.readText(path.join(dir, 'source.properties'))) ?? '') ?? '?');
}

/** sdkmanager presente não basta: ele precisa do JRE do Enxame ou de um Java ≥ 17 no PATH. */
async function probeSdkTools(paths: SetupPaths, d: ProbeDeps): Promise<DepStatus> {
  const dir = path.join(paths.sdkRoot, 'cmdline-tools', 'latest');
  const s = await sdkPackage('sdk', path.join(dir, 'bin', 'sdkmanager'), dir, d);
  if (s.state !== 'ok' || (await d.exists(path.join(paths.jreDir, 'bin', 'java')))) return s;
  const major = javaMajor(await d.exec('java', ['-version']));
  return major !== null && major >= MIN_JAVA ? s : { ...todo('sdk'), sizeMb: JRE_ONLY_MB };
}

async function probeKvm(d: ProbeDeps): Promise<DepStatus> {
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
  const sdk = paths.sdkRoot;
  const img = path.join(sdk, 'system-images', 'android-34', 'google_apis_playstore', 'x86_64');
  const nodeOut = await d.exec('node', ['--version']);
  const major = nodeMajor(nodeOut);
  const node = major !== null && major >= MIN_NODE ? ok('node', nodeOut!.trim().replace(/^v/, '')) : user('node', 'node-missing');
  const [sdkS, adb, emu, sysImg, kvm, ollama, keyringOk, localModels] = await Promise.all([
    probeSdkTools(paths, d),
    sdkPackage('adb', path.join(sdk, 'platform-tools', 'adb'), path.join(sdk, 'platform-tools'), d),
    sdkPackage('emu', path.join(sdk, 'emulator', 'emulator'), path.join(sdk, 'emulator'), d),
    sdkPackage('img', path.join(img, 'system.img'), img, d),
    probeKvm(d),
    findOllama(paths, d),
    d.keyringOk(),
    listLocalModels(paths.ollamaModels, d),
  ]);
  const deps = [
    node, sdkS, adb, emu, sysImg, kvm,
    ollama ? ok('ollama', ollama.version) : todo('ollama'),
    keyringOk ? ok('keyring', null) : user('keyring', 'keyring-locked'),
  ];
  return { deps, ollamaBin: ollama?.bin ?? null, localModels };
}

export async function probeSetup(paths: SetupPaths, d: ProbeDeps, hw: HardwareDeps): Promise<ProbeResult> {
  const home = path.dirname(path.dirname(paths.ollamaModels)) || '/';
  const [p, hardware] = await Promise.all([probeDeps(paths, d), readHardware(home, hw)]);
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
