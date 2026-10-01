import { cp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CONFIG, currentBaseAvd } from '../config.js';
import { setIniKeys } from './ini.js';

/** Provisionamento por clone do AVD-base (spec inc. 5 §2): cópia do diretório + `.ini` reescrito. */
const AVD_NAME = /^[A-Za-z0-9_]{1,40}$/;
export const isValidAvdName = (name: string): boolean => AVD_NAME.test(name);

/** Estado de execução que não pode ir para o clone: locks do emulador, snapshot (o clone nasce sem) e arquivos regenerados no boot com caminhos da base. */
const SKIP_TOP = new Set(['snapshots', 'tmpAdbCmds', 'hardware-qemu.ini', 'emu-launch-params.txt', 'read-snapshot.txt', 'bootcompleted.ini']);
const skipped = (rel: string) => /\.lock$/.test(rel) || SKIP_TOP.has(rel.split(path.sep)[0]);

export interface AvdDeps { readonly home?: string }

const exists = async (p: string) => { try { await stat(p); return true; } catch { return false; } };
const avdDir = (home: string, name: string) => path.join(home, `${name}.avd`);
const iniPath = (home: string, name: string) => path.join(home, `${name}.ini`);

function assertName(name: string): void {
  if (!isValidAvdName(name)) throw new Error(`nome de AVD inválido: "${name}" (use [A-Za-z0-9_], até 40)`);
}

/** Já existe um AVD com esse nome no disco (de outra instalação ou outro TAPFLOCK_DATA_DIR, que não está no banco)? */
export async function avdExists(name: string, deps: AvdDeps = {}): Promise<boolean> {
  const home = deps.home ?? CONFIG.avd.home;
  return (await exists(avdDir(home, name))) || (await exists(iniPath(home, name)));
}

export async function cloneAvd(base: string, newName: string, deps: AvdDeps = {}): Promise<{ avdDir: string; iniPath: string }> {
  const home = deps.home ?? CONFIG.avd.home;
  assertName(base); assertName(newName);
  const src = avdDir(home, base); const dst = avdDir(home, newName); const dstIni = iniPath(home, newName);
  if (!(await exists(src))) {
    throw new Error(`AVD-base ${base} não encontrado em ${home}. Crie no Android Studio um AVD Android 14 com Google Play chamado tapflock_golden, com o app alvo e o app MCP instalados, ou aponte TAPFLOCK_AVD_BASE para o seu`);
  }
  if ((await exists(dst)) || (await exists(dstIni))) throw new Error(`AVD ${newName} já existe em ${home}`);
  try {
    const baseIni = await readFile(iniPath(home, base), 'utf8');
    await cp(src, dst, { recursive: true, errorOnExist: true, force: false, filter: (s) => !skipped(path.relative(src, s)) });
    const relDir = /^path\.rel=(.*)$/m.exec(baseIni)?.[1]?.trim();
    const rel = path.posix.join(relDir ? path.posix.dirname(relDir) : 'avd', `${newName}.avd`);
    await writeFile(dstIni, setIniKeys(baseIni, { path: dst, 'path.rel': rel }), { flag: 'wx' });
    const cfg = path.join(dst, 'config.ini');
    await writeFile(cfg, setIniKeys(await readFile(cfg, 'utf8'), { AvdId: newName, 'avd.ini.displayname': newName }));
  } catch (e) {
    // Clone pela metade nunca fica no disco: vira lixo de GBs sem identidade apontando para ele.
    await rm(dst, { recursive: true, force: true }).catch(() => undefined);
    await rm(dstIni, { force: true }).catch(() => undefined);
    throw e;
  }
  return { avdDir: dst, iniPath: dstIni };
}

export async function deleteAvd(name: string, deps: AvdDeps & { readonly base?: string } = {}): Promise<void> {
  const home = deps.home ?? CONFIG.avd.home;
  assertName(name);
  if (name === (deps.base ?? currentBaseAvd().name)) throw new Error(`recusado: ${name} é o AVD-base`);
  await rm(avdDir(home, name), { recursive: true, force: true });
  await rm(iniPath(home, name), { force: true });
}
