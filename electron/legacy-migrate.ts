import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BRAND, LEGACY_BRAND, LEGACY_PRODUCT_NAME, PRODUCT_NAME, brandEnv } from './brand.js';

/**
 * Migração do nome antigo (Enxame, até a 0.1.0) para o atual, feita pelo main antes de tudo: a pasta de dados
 * (`~/.local/share/enxame`) e a pasta de perfil do Electron (`<appData>/Enxame`, com o idioma salvo). A chave do
 * cofre no chaveiro migra no daemon (daemon/src/vault/keyring.ts). Qualquer falha deixa tudo como estava, e o main
 * e o daemon seguem na pasta antiga (brand.ts `dataDirFrom`) até a próxima subida tentar de novo.
 */
export interface MigrateDeps {
  exists(p: string): boolean;
  rename(from: string, to: string): void;
  readFile(p: string): string;
  writeFile(p: string, data: string): void;
  alive(pid: number): boolean;
  stop(pid: number): void;
  sleep(ms: number): Promise<void>;
  log(message: string): void;
}

export type MigrateOutcome = 'migrated' | 'skipped' | 'failed';

const STOP_WAIT_MS = 10_000;
const STOP_POLL_MS = 250;
const DB_SUFFIXES = ['-wal', '-shm', ''] as const;

const errMsg = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 200);

function daemonPid(dir: string, deps: MigrateDeps): number | null {
  try {
    const pid = (JSON.parse(deps.readFile(path.join(dir, 'daemon.json'))) as { pid?: unknown }).pid;
    return typeof pid === 'number' ? pid : null;
  } catch { return null; }
}

/** O daemon sobrevive ao app: o da versão antiga pode estar rodando com o banco aberto na pasta que vai mudar. */
async function stopLegacyDaemon(dir: string, deps: MigrateDeps): Promise<boolean> {
  const pid = daemonPid(dir, deps);
  if (pid === null || !deps.alive(pid)) return true;
  deps.log(`parando o daemon antigo (pid ${pid}) para migrar a pasta de dados`);
  try { deps.stop(pid); } catch (e) { deps.log(`não deu para parar o daemon antigo (pid ${pid}): ${errMsg(e)}`); return false; }
  for (let waited = 0; waited < STOP_WAIT_MS; waited += STOP_POLL_MS) {
    if (!deps.alive(pid)) return true;
    await deps.sleep(STOP_POLL_MS);
  }
  if (!deps.alive(pid)) return true;
  deps.log(`o daemon antigo (pid ${pid}) não parou; a pasta de dados fica com o nome antigo por enquanto`);
  return false;
}

/** Banco com WAL e SHM: os três trocam de nome juntos ou nenhum troca (banco sem o WAL perderia dados). */
function renameDb(dir: string, deps: MigrateDeps): void {
  const done: Array<[string, string]> = [];
  try {
    for (const suffix of DB_SUFFIXES) {
      const from = path.join(dir, `${LEGACY_BRAND}.sqlite${suffix}`);
      const to = path.join(dir, `${BRAND}.sqlite${suffix}`);
      if (!deps.exists(from)) continue;
      deps.rename(from, to);
      done.push([from, to]);
    }
  } catch (e) {
    deps.log(`banco mantido com o nome antigo: ${errMsg(e)}`);
    for (const [from, to] of done.reverse()) {
      try { deps.rename(to, from); } catch (undo) { deps.log(`não deu para desfazer ${to}: ${errMsg(undo)}`); }
    }
  }
}

/** Caminhos absolutos que o onboarding gravou dentro da pasta antiga (ex.: o Ollama instalado em tools/). */
function rewriteSetupPaths(legacyDir: string, freshDir: string, deps: MigrateDeps): void {
  const file = path.join(freshDir, 'setup.json');
  if (!deps.exists(file)) return;
  try {
    const setup = JSON.parse(deps.readFile(file)) as { paths?: Record<string, unknown> };
    if (!setup.paths) return;
    const moved = (v: unknown) =>
      typeof v === 'string' && (v === legacyDir || v.startsWith(legacyDir + path.sep)) ? freshDir + v.slice(legacyDir.length) : v;
    const paths = Object.fromEntries(Object.entries(setup.paths).map(([k, v]) => [k, moved(v)]));
    deps.writeFile(file, JSON.stringify({ ...setup, paths }, null, 2));
  } catch (e) {
    deps.log(`setup.json não foi atualizado: ${errMsg(e)}`);
  }
}

export async function migrateDataDir(env: NodeJS.ProcessEnv, home: string, deps: MigrateDeps = nodeMigrateDeps): Promise<MigrateOutcome> {
  if (brandEnv(env, 'DATA_DIR')) return 'skipped';
  const legacyDir = path.join(home, '.local', 'share', LEGACY_BRAND);
  const freshDir = path.join(home, '.local', 'share', BRAND);
  if (deps.exists(freshDir) || !deps.exists(legacyDir)) return 'skipped';
  if (!(await stopLegacyDaemon(legacyDir, deps))) return 'failed';
  try {
    deps.rename(legacyDir, freshDir);
  } catch (e) {
    deps.log(`pasta de dados mantida em ${legacyDir}: ${errMsg(e)}`);
    return 'failed';
  }
  renameDb(freshDir, deps);
  rewriteSetupPaths(legacyDir, freshDir, deps);
  deps.log(`pasta de dados migrada de ${legacyDir} para ${freshDir}`);
  return 'migrated';
}

/** Chamar antes do `app.whenReady()`: depois disso o Chromium já abriu a pasta de perfil. */
export function migrateUserData(appData: string, deps: MigrateDeps = nodeMigrateDeps): MigrateOutcome {
  const legacyDir = path.join(appData, LEGACY_PRODUCT_NAME);
  const freshDir = path.join(appData, PRODUCT_NAME);
  if (deps.exists(freshDir) || !deps.exists(legacyDir)) return 'skipped';
  try {
    deps.rename(legacyDir, freshDir);
    return 'migrated';
  } catch (e) {
    deps.log(`pasta de perfil mantida em ${legacyDir}: ${errMsg(e)}`);
    return 'failed';
  }
}

const isAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

export const nodeMigrateDeps: MigrateDeps = {
  exists: existsSync,
  rename: renameSync,
  readFile: (p) => readFileSync(p, 'utf8'),
  writeFile: (p, data) => writeFileSync(p, data),
  alive: isAlive,
  stop: (pid) => { process.kill(pid, 'SIGTERM'); },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log: (m) => console.log(`[tapflock] ${m}`),
};
