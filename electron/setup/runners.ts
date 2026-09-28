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
  /** Espera entre tentativas do rename (testes injetam). */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Ambiente de base dos processos; padrão `process.env`. */
  readonly baseEnv?: NodeJS.ProcessEnv;
}

const toMb = (bytes: number) => bytes / 1e6;

export function parseSdkPercent(line: string): number | null {
  const m = /\]\s*(\d{1,3})%/.exec(line);
  return m ? Math.min(100, Number(m[1])) : null;
}

/** No Windows os caminhos usam `\`; nas demais plataformas, `/`. */
const pathOf = (d: RunnerDeps) => (isWindows(d.paths.platform) ? path.win32 : path.posix);

/**
 * JAVA_HOME no JRE do Tapflock quando ele existe; senão o Java que a pessoa já tem.
 * No Windows a chave costuma ser `Path`: reusa a que existir, senão o filho recebe duas e uma delas some.
 */
async function sdkEnv(d: RunnerDeps): Promise<NodeJS.ProcessEnv> {
  const base = d.baseEnv ?? process.env;
  if (!(await d.exists(d.paths.javaBin))) return base;
  const key = Object.keys(base).find((k) => /^path$/i.test(k)) ?? 'PATH';
  return {
    ...base,
    JAVA_HOME: d.paths.javaHome,
    [key]: `${pathOf(d).join(d.paths.javaHome, 'bin')}${isWindows(d.paths.platform) ? ';' : ':'}${base[key] ?? ''}`,
  };
}

const RENAME_TRIES = 5;
const RENAME_WAIT_MS = 200;
const TRANSIENT = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** Windows: antivírus/indexador segura a pasta recém-extraída por instantes; EPERM/EACCES/EBUSY repetem. */
async function renameRetry(d: RunnerDeps, from: string, to: string): Promise<void> {
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 1; ; i++) {
    try { await d.fs.rename(from, to); return; } catch (e) {
      if (i >= RENAME_TRIES || !TRANSIENT.has(String((e as NodeJS.ErrnoException).code))) throw e;
      await sleep(RENAME_WAIT_MS);
    }
  }
}

/** Aspas só quando o argumento tem espaço (os args aqui nunca trazem aspas). */
const q = (arg: string): string => (arg.includes(' ') ? `"${arg}"` : arg);

/**
 * No Windows o sdkmanager é um .bat, que o spawn só roda pelo cmd. `/d /s /c "<bat com espaço> args..."`
 * evita que o cmd, ao tirar as aspas externas, quebre um caminho com espaço (ex.: `C:\Users\John Doe\...`);
 * `verbatim` impede o libuv de re-aspar essa linha já montada.
 */
function runSdkmanager(d: RunnerDeps, args: readonly string[], o: ProcOpts): Promise<void> {
  if (!isWindows(d.paths.platform)) return d.run(d.paths.sdkmanager, args, o);
  const bat = d.paths.sdkmanager;
  return d.run('cmd', ['/d', '/s', '/c', `""${bat}" ${args.map(q).join(' ')}"`], { ...o, verbatim: true });
}

/** Abre o pacote conforme o formato; `strip` tira a pasta de cima (JRE). */
async function extractArchive(d: RunnerDeps, a: Pinned, file: string, dest: string, strip: boolean): Promise<void> {
  if (a.format === 'zip') {
    if (!strip) { await d.extractZip(file, dest); return; }
    const tmp = `${dest}-unzip`;
    await d.fs.rm(tmp, { recursive: true, force: true });
    await d.extractZip(file, tmp);
    const entries = await d.fs.readdir(tmp);
    if (entries.length !== 1) throw new SetupError('process', 'o pacote do Java veio com um formato inesperado');
    const [inner] = entries;
    await d.fs.rm(dest, { recursive: true, force: true });
    await renameRetry(d, pathOf(d).join(tmp, inner), dest);
    await d.fs.rm(tmp, { recursive: true, force: true });
    return;
  }
  const flags = a.format === 'tar.zst' ? ['--zstd', '-xf'] : ['-xzf'];
  await d.fs.mkdir(dest, { recursive: true });
  await d.run('tar', [...flags, file, '-C', dest, ...(strip ? ['--strip-components=1'] : [])], { onLine: d.log });
}

/** JRE do Tapflock; pulado quando já foi extraído antes. */
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
  await renameRetry(d, pathOf(d).join(unzipDir, 'cmdline-tools'), latest);
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
  // Confere antes de apagar o pacote: uma nova tentativa reaproveita o download (~1,4 GB).
  if (!(await d.exists(d.paths.ollamaBin))) {
    throw new SetupError('process', `o pacote do Ollama não trouxe ${pathOf(d).relative(d.paths.ollamaDir, d.paths.ollamaBin)}`);
  }
  await d.fs.rm(file, { recursive: true, force: true });
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
