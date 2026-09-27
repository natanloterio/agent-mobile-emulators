import { access, chmod, mkdir, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import extractZip from 'extract-zip';
import { downloadResumable, type Checksum, type DownloadOpts } from './download.js';
import { SetupError } from './errors.js';
import { nodePullDeps, pullModel } from './ollama-pull.js';
import type { SetupPaths } from './paths.js';
import { SIZES_MB, SYSTEM_IMAGE } from './probe.js';
import { runProcess, type ProcOpts } from './proc.js';
import type { JobId } from './types.js';

export type Progress = (doneMb: number, totalMb: number) => void;
export type JobRunner = (progress: Progress) => Promise<void>;
export type JobRunners = Readonly<Record<JobId, JobRunner>>;

interface Pinned { readonly url: string; readonly checksum: Checksum; readonly sizeMb: number }
/** Versões fixadas (spec onboarding §Arquitetura). Para atualizar: nova URL, novo checksum da fonte oficial, novo tamanho. */
export const JRE: Pinned = {
  url: 'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.20.1%2B1/OpenJDK17U-jre_x64_linux_hotspot_17.0.20.1_1.tar.gz',
  checksum: { algo: 'sha256', hex: '0b2b640e3046b64c8ec504de0ab9d91bb5610182bda21fad454681ce54d45a62' }, sizeMb: 47,
};
export const CMDLINE_TOOLS: Pinned = {
  url: 'https://dl.google.com/android/repository/commandlinetools-linux-16111833_latest.zip',
  checksum: { algo: 'sha1', hex: 'e025545c62a8e64c7559119566a569fb1dec5f60' }, sizeMb: 181,
};
export const OLLAMA: Pinned = {
  url: 'https://github.com/ollama/ollama/releases/download/v0.34.4/ollama-linux-amd64.tar.zst',
  checksum: { algo: 'sha256', hex: 'c238986e61d40c0cc5f4a9b9e40b9eea104350b77efa34741fc134e105cb9533' }, sizeMb: SIZES_MB.ollama,
};

export interface RunnerDeps {
  readonly paths: SetupPaths;
  readonly download: (o: DownloadOpts) => Promise<void>;
  readonly run: (cmd: string, args: readonly string[], o?: ProcOpts) => Promise<void>;
  readonly extractZip: (zip: string, dir: string) => Promise<void>;
  readonly fs: {
    readonly rm: (p: string, o: { recursive: true; force: true }) => Promise<void>;
    readonly mkdir: (p: string, o: { recursive: true }) => Promise<unknown>;
    readonly rename: (a: string, b: string) => Promise<void>;
    readonly chmod: (p: string, mode: number) => Promise<void>;
    readonly readdir: (p: string) => Promise<readonly string[]>;
  };
  readonly exists: (p: string) => Promise<boolean>;
  readonly pull: (model: string, bin: string, progress: Progress) => Promise<void>;
  readonly log: (line: string) => void;
}

const toMb = (bytes: number) => bytes / 1e6;

export function parseSdkPercent(line: string): number | null {
  const m = /\]\s*(\d{1,3})%/.exec(line);
  return m ? Math.min(100, Number(m[1])) : null;
}

const sdkmanager = (d: RunnerDeps) => path.join(d.paths.sdkRoot, 'cmdline-tools', 'latest', 'bin', 'sdkmanager');

/** JAVA_HOME no JRE do Enxame quando ele existe; senão o Java que a pessoa já tem. */
async function sdkEnv(d: RunnerDeps): Promise<NodeJS.ProcessEnv> {
  if (!(await d.exists(path.join(d.paths.jreDir, 'bin', 'java')))) return process.env;
  return { ...process.env, JAVA_HOME: d.paths.jreDir, PATH: `${path.join(d.paths.jreDir, 'bin')}:${process.env.PATH ?? ''}` };
}

async function installCmdlineTools(d: RunnerDeps, progress: Progress): Promise<void> {
  const total = JRE.sizeMb + CMDLINE_TOOLS.sizeMb;
  const dl = d.paths.downloadsDir;
  const jreFile = path.join(dl, 'jre.tar.gz');
  await d.download({ url: JRE.url, dest: jreFile, checksum: JRE.checksum, onProgress: (b) => progress(Math.min(JRE.sizeMb, toMb(b)), total) });
  await d.fs.rm(d.paths.jreDir, { recursive: true, force: true });
  await d.fs.mkdir(d.paths.jreDir, { recursive: true });
  await d.run('tar', ['-xzf', jreFile, '-C', d.paths.jreDir, '--strip-components=1'], { onLine: d.log });
  await d.fs.rm(jreFile, { recursive: true, force: true });

  const zip = path.join(dl, 'cmdline-tools.zip');
  await d.download({ url: CMDLINE_TOOLS.url, dest: zip, checksum: CMDLINE_TOOLS.checksum, onProgress: (b) => progress(JRE.sizeMb + Math.min(CMDLINE_TOOLS.sizeMb, toMb(b)), total) });
  const unzipDir = path.join(dl, 'cmdline-tools-unzip');
  await d.fs.rm(unzipDir, { recursive: true, force: true });
  await d.extractZip(zip, unzipDir); // o zip traz uma pasta `cmdline-tools/`
  const latest = path.join(d.paths.sdkRoot, 'cmdline-tools', 'latest');
  await d.fs.rm(latest, { recursive: true, force: true });
  await d.fs.mkdir(path.dirname(latest), { recursive: true });
  await d.fs.rename(path.join(unzipDir, 'cmdline-tools'), latest);
  const bin = path.join(latest, 'bin');
  for (const f of await d.fs.readdir(bin)) await d.fs.chmod(path.join(bin, f), 0o755);
  await d.fs.rm(zip, { recursive: true, force: true });

  await d.run(sdkmanager(d), [`--sdk_root=${d.paths.sdkRoot}`, '--licenses'], { env: await sdkEnv(d), stdin: 'y\n'.repeat(30), onLine: d.log });
  progress(total, total);
}

async function installSdkPackage(pkg: string, sizeMb: number, d: RunnerDeps, progress: Progress): Promise<void> {
  await d.run(sdkmanager(d), [`--sdk_root=${d.paths.sdkRoot}`, '--install', pkg], {
    env: await sdkEnv(d), stdin: 'y\n'.repeat(5),
    onLine: (line) => { d.log(line); const pct = parseSdkPercent(line); if (pct !== null) progress((sizeMb * pct) / 100, sizeMb); },
  });
  progress(sizeMb, sizeMb);
}

async function installOllama(d: RunnerDeps, progress: Progress): Promise<void> {
  const file = path.join(d.paths.downloadsDir, 'ollama-linux-amd64.tar.zst');
  await d.download({ url: OLLAMA.url, dest: file, checksum: OLLAMA.checksum, onProgress: (b) => progress(Math.min(OLLAMA.sizeMb, toMb(b)), OLLAMA.sizeMb) });
  await d.fs.rm(d.paths.ollamaDir, { recursive: true, force: true });
  await d.fs.mkdir(d.paths.ollamaDir, { recursive: true });
  try {
    await d.run('tar', ['--zstd', '-xf', file, '-C', d.paths.ollamaDir], { onLine: d.log });
  } catch (e) {
    if (/zstd/i.test(String((e as Error).message))) throw new SetupError('process', 'o tar precisa do zstd para abrir o Ollama; rode no terminal: sudo apt install zstd', { cause: e });
    throw e;
  }
  await d.fs.rm(file, { recursive: true, force: true });
  progress(OLLAMA.sizeMb, OLLAMA.sizeMb);
}

export function createRunners(localModel: string, ollamaBin: string, d: RunnerDeps): JobRunners {
  return {
    sdk: (p) => installCmdlineTools(d, p),
    adb: (p) => installSdkPackage('platform-tools', SIZES_MB.adb, d, p),
    emu: (p) => installSdkPackage('emulator', SIZES_MB.emu, d, p),
    img: (p) => installSdkPackage(SYSTEM_IMAGE, SIZES_MB.img, d, p),
    ollama: (p) => installOllama(d, p),
    model: (p) => d.pull(localModel, ollamaBin, p),
  };
}

export function nodeRunnerDeps(paths: SetupPaths, log: (line: string) => void): RunnerDeps {
  return {
    paths,
    download: downloadResumable,
    run: (cmd, args, o) => runProcess(cmd, args, o),
    extractZip: (zip, dir) => extractZip(zip, { dir }),
    fs: { rm, mkdir, rename, chmod, readdir },
    exists: (p) => access(p).then(() => true, () => false),
    pull: (model, bin, progress) => pullModel(model, bin, nodePullDeps(log), progress),
    log,
  };
}
