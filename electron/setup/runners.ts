import { access, chmod, mkdir, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import extractZip from 'extract-zip';
import { artifactsFor, sizesFor, type Pinned } from './artifacts.js';
import { downloadResumable, type DownloadOpts } from './download.js';
import { SetupError } from './errors.js';
import { nodePullDeps, pullModel } from './ollama-pull.js';
import type { SetupPaths } from './paths.js';
import { isWindows, systemImage } from './platform.js';
import { runProcess, type ProcOpts } from './proc.js';
import type { JobId } from './types.js';

export type Progress = (doneMb: number, totalMb: number) => void;
export type JobRunner = (progress: Progress) => Promise<void>;
export type JobRunners = Readonly<Record<JobId, JobRunner>>;

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

/** No Windows os caminhos usam `\`; nas demais plataformas, `/`. */
const pathOf = (d: RunnerDeps) => (isWindows(d.paths.platform) ? path.win32 : path.posix);

/** JAVA_HOME no JRE do Enxame quando ele existe; senão o Java que a pessoa já tem. */
async function sdkEnv(d: RunnerDeps): Promise<NodeJS.ProcessEnv> {
  if (!(await d.exists(d.paths.javaBin))) return process.env;
  return {
    ...process.env,
    JAVA_HOME: d.paths.javaHome,
    PATH: `${pathOf(d).join(d.paths.javaHome, 'bin')}${isWindows(d.paths.platform) ? ';' : ':'}${process.env.PATH ?? ''}`,
  };
}

/** No Windows o sdkmanager é um .bat, que o spawn só roda pelo cmd. */
function runSdkmanager(d: RunnerDeps, args: readonly string[], o: ProcOpts): Promise<void> {
  return isWindows(d.paths.platform) ? d.run('cmd', ['/c', d.paths.sdkmanager, ...args], o) : d.run(d.paths.sdkmanager, args, o);
}

/** Abre o pacote conforme o formato; `strip` tira a pasta de cima (JRE). */
async function extractArchive(d: RunnerDeps, a: Pinned, file: string, dest: string, strip: boolean): Promise<void> {
  if (a.format === 'zip') {
    if (!strip) { await d.extractZip(file, dest); return; }
    const tmp = `${dest}-unzip`;
    await d.fs.rm(tmp, { recursive: true, force: true });
    await d.extractZip(file, tmp);
    const [inner] = await d.fs.readdir(tmp);
    await d.fs.rm(dest, { recursive: true, force: true });
    await d.fs.rename(pathOf(d).join(tmp, inner), dest);
    await d.fs.rm(tmp, { recursive: true, force: true });
    return;
  }
  const flags = a.format === 'tar.zst' ? ['--zstd', '-xf'] : ['-xzf'];
  await d.fs.mkdir(dest, { recursive: true });
  await d.run('tar', [...flags, file, '-C', dest, ...(strip ? ['--strip-components=1'] : [])], { onLine: d.log });
}

/** JRE do Enxame; pulado quando já foi extraído antes. */
async function installJre(d: RunnerDeps, onBytes: (b: number) => void): Promise<void> {
  const a = artifactsFor(d.paths.platform).jre;
  const file = pathOf(d).join(d.paths.downloadsDir, a.format === 'zip' ? 'jre.zip' : 'jre.tar.gz');
  await d.download({ url: a.url, dest: file, checksum: a.checksum, onProgress: onBytes });
  await d.fs.rm(d.paths.jreDir, { recursive: true, force: true });
  await extractArchive(d, a, file, d.paths.jreDir, true);
  await d.fs.rm(file, { recursive: true, force: true });
}

/** cmdline-tools em `<sdk>/cmdline-tools/latest`; pulado quando o sdkmanager já existe (repetir não baixa de novo). */
async function installToolsZip(d: RunnerDeps, onBytes: (b: number) => void): Promise<void> {
  const a = artifactsFor(d.paths.platform).cmdlineTools;
  const dl = d.paths.downloadsDir;
  const zip = pathOf(d).join(dl, 'cmdline-tools.zip');
  await d.download({ url: a.url, dest: zip, checksum: a.checksum, onProgress: onBytes });
  const unzipDir = pathOf(d).join(dl, 'cmdline-tools-unzip');
  await d.fs.rm(unzipDir, { recursive: true, force: true });
  await d.extractZip(zip, unzipDir); // o zip traz uma pasta `cmdline-tools/`
  const latest = pathOf(d).join(d.paths.sdkRoot, 'cmdline-tools', 'latest');
  await d.fs.rm(latest, { recursive: true, force: true });
  await d.fs.mkdir(pathOf(d).dirname(latest), { recursive: true });
  await d.fs.rename(pathOf(d).join(unzipDir, 'cmdline-tools'), latest);
  if (!isWindows(d.paths.platform)) {
    const bin = pathOf(d).join(latest, 'bin');
    for (const f of await d.fs.readdir(bin)) await d.fs.chmod(pathOf(d).join(bin, f), 0o755);
  }
  await d.fs.rm(zip, { recursive: true, force: true });
}

async function installCmdlineTools(d: RunnerDeps, progress: Progress): Promise<void> {
  const { jre, cmdlineTools } = artifactsFor(d.paths.platform);
  const needJre = !(await d.exists(d.paths.javaBin));
  const needTools = !(await d.exists(d.paths.sdkmanager));
  const jreMb = needJre ? jre.sizeMb : 0;
  const total = jreMb + (needTools ? cmdlineTools.sizeMb : 0);
  if (needJre) await installJre(d, (b) => progress(Math.min(jre.sizeMb, toMb(b)), total));
  if (needTools) await installToolsZip(d, (b) => progress(jreMb + Math.min(cmdlineTools.sizeMb, toMb(b)), total));
  await runSdkmanager(d, [`--sdk_root=${d.paths.sdkRoot}`, '--licenses'], { env: await sdkEnv(d), stdin: 'y\n'.repeat(30), onLine: d.log });
  progress(total, total);
}

async function installSdkPackage(pkg: string, sizeMb: number, d: RunnerDeps, progress: Progress): Promise<void> {
  await runSdkmanager(d, [`--sdk_root=${d.paths.sdkRoot}`, '--install', pkg], {
    env: await sdkEnv(d), stdin: 'y\n'.repeat(5),
    onLine: (line) => { d.log(line); const pct = parseSdkPercent(line); if (pct !== null) progress((sizeMb * pct) / 100, sizeMb); },
  });
  progress(sizeMb, sizeMb);
}

async function installOllama(d: RunnerDeps, progress: Progress): Promise<void> {
  const a = artifactsFor(d.paths.platform).ollama;
  const file = pathOf(d).join(d.paths.downloadsDir, a.file);
  await d.download({ url: a.url, dest: file, checksum: a.checksum, onProgress: (b) => progress(Math.min(a.sizeMb, toMb(b)), a.sizeMb) });
  await d.fs.rm(d.paths.ollamaDir, { recursive: true, force: true });
  await d.fs.mkdir(d.paths.ollamaDir, { recursive: true });
  try {
    await extractArchive(d, a, file, d.paths.ollamaDir, false);
  } catch (e) {
    if (/zstd/i.test(String((e as Error).message))) throw new SetupError('process', 'o tar precisa do zstd para abrir o Ollama; rode no terminal: sudo apt install zstd', { cause: e });
    throw e;
  }
  await d.fs.rm(file, { recursive: true, force: true });
  if (!(await d.exists(d.paths.ollamaBin))) {
    throw new SetupError('process', `o pacote do Ollama não trouxe ${pathOf(d).relative(d.paths.ollamaDir, d.paths.ollamaBin)}`);
  }
  if (!isWindows(d.paths.platform)) await d.fs.chmod(d.paths.ollamaBin, 0o755);
  progress(a.sizeMb, a.sizeMb);
}

export function createRunners(localModel: string, ollamaBin: string, d: RunnerDeps): JobRunners {
  const sizes = sizesFor(d.paths.platform);
  return {
    sdk: (p) => installCmdlineTools(d, p),
    adb: (p) => installSdkPackage('platform-tools', sizes.adb, d, p),
    emu: (p) => installSdkPackage('emulator', sizes.emu, d, p),
    img: (p) => installSdkPackage(systemImage(d.paths.platform), sizes.img, d, p),
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
