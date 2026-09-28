import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { BRAND, LEGACY_BRAND, brandEnv, dataDirFrom, dbFileIn } from './brand.js';
import { sdkPaths, sdkRoot } from './device/sdk.js';

const DATA_DIR = dataDirFrom(process.env);

/** AVD dourado criado a partir da conta1 com ela parada (clone sem conta de terceiro após o primeiro boot). */
export const GOLDEN_AVD = `${BRAND}_golden`;
/** Dourada criada antes da troca de nome (Enxame). */
export const LEGACY_GOLDEN_AVD = `${LEGACY_BRAND}_golden`;
/** Base de clonagem: `TAPFLOCK_AVD_BASE`, senão a dourada (a nova, depois a de antes da troca), senão o AVD da conta1 (que precisa estar parado). */
export function pickBaseAvd(envBase: string | undefined, avdHome: string, exists: (p: string) => boolean = existsSync): string {
  if (envBase) return envBase;
  return [GOLDEN_AVD, LEGACY_GOLDEN_AVD].find((avd) => exists(path.join(avdHome, `${avd}.avd`))) ?? 'mcp_test_playstore';
}
export interface BaseAvdStatus { readonly name: string; readonly found: boolean }
/** Com o emulador da base ligado (o snapshot mede; o provisionamento recusa enquanto isso). */
export interface BaseAvdLive extends BaseAvdStatus { readonly running: boolean; readonly prep?: import('./db/base-settings.js').BasePrep }
/** Base que o provisionamento vai clonar e se ela existe; sem nenhuma, o nome sugerido é a dourada. */
export function baseAvdStatus(envBase: string | undefined, avdHome: string, exists: (p: string) => boolean = existsSync): BaseAvdStatus {
  const name = pickBaseAvd(envBase, avdHome, exists);
  if (exists(path.join(avdHome, `${name}.avd`))) return { name, found: true };
  return { name: envBase ?? GOLDEN_AVD, found: false };
}
/** Relido a cada chamada: a base criada no Android Studio com o daemon já rodando vale sem reiniciar. */
export const currentBaseAvd = (): BaseAvdStatus => baseAvdStatus(brandEnv(process.env, 'AVD_BASE'), AVD_HOME);
const AVD_HOME = process.env.ANDROID_AVD_HOME ?? path.join(os.homedir(), '.android', 'avd');

/** Caminhos que o onboarding (electron/setup) grava em `<dados>/setup.json`; o daemon só lê. */
export interface SetupPaths { readonly sdkRoot: string | null; readonly ollamaBin: string | null }
const NO_SETUP: SetupPaths = { sdkRoot: null, ollamaBin: null };
const SetupFileSchema = z.object({ paths: z.object({ sdkRoot: z.string().min(1), ollamaBin: z.string().min(1).nullable() }) });

/** Arquivo ausente, ilegível ou com outro formato: nenhum caminho (cai nos padrões). */
export function readSetupPaths(file: string, read: (p: string) => string = (p) => readFileSync(p, 'utf8')): SetupPaths {
  try {
    const parsed = SetupFileSchema.safeParse(JSON.parse(read(file)));
    return parsed.success ? parsed.data.paths : NO_SETUP;
  } catch { return NO_SETUP; }
}

/** SDK do Android: setup.json primeiro, depois as regras por SO de `sdkRoot` (env, senão o padrão do Android Studio). */
export function sdkRootFrom(setup: SetupPaths, env: NodeJS.ProcessEnv, home: string, platform: NodeJS.Platform = process.platform): string {
  return sdkRoot(env, platform, home, setup.sdkRoot);
}

/** Binário do Ollama: `TAPFLOCK_OLLAMA_BIN`, o que o onboarding instalou ou achou, senão o `ollama` do PATH. */
export function ollamaBinFrom(setup: SetupPaths, env: NodeJS.ProcessEnv): string {
  return brandEnv(env, 'OLLAMA_BIN') || setup.ollamaBin || 'ollama';
}

const SETUP_PATH = path.join(DATA_DIR, 'setup.json');
const SETUP = readSetupPaths(SETUP_PATH);
const SDK_ROOT = sdkRootFrom(SETUP, process.env, os.homedir());
/** adb e emulator do Android SDK (setup.json, `ANDROID_HOME`/`ANDROID_SDK_ROOT` ou o local padrão do SO; `.exe` no Windows). */
const SDK = sdkPaths(process.env, process.platform, os.homedir(), SETUP.sdkRoot);

/** Orçamento de passos de uma env var: `"0"` desliga (`null` = sem limite); inteiro positivo vale; ausente, vazio, NaN, negativo ou não inteiro caem no `fallback`. */
export function stepBudgetFrom(raw: string | undefined, fallback: number): number | null {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return fallback;
  return n === 0 ? null : n;
}

/** Contexto dos modelos locais via `TAPFLOCK_LOCAL_CONTEXT`: inteiro ≥ 8192 vale; ausente, lixo ou menor cai no padrão 65536 (mais contexto usa mais VRAM). */
export function localContextFrom(raw: string | undefined, fallback = 65536): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 8192 ? n : fallback;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Processos externos (adb push) não leem dentro do app.asar; o electron-builder deixa o vendor em app.asar.unpacked. */
export function unpackedPath(p: string): string {
  return p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
}

/** Resolve um arquivo de `daemon/vendor` tanto a partir de `daemon/src` (vitest) quanto de `dist-daemon` (build). */
function resolveVendor(file: string): string {
  const candidates = [path.resolve(HERE, '..', 'daemon', 'vendor', file), path.resolve(HERE, '..', '..', 'daemon', 'vendor', file)];
  return unpackedPath(candidates.find((p) => existsSync(p)) ?? candidates[0]);
}

export const CONFIG = {
  dataDir: DATA_DIR,
  dbPath: dbFileIn(DATA_DIR),
  daemonInfoPath: path.join(DATA_DIR, 'daemon.json'),
  /** Cofre de segredos do daemon (spec missões §Cofre); a chave fica no chaveiro do SO. */
  vaultPath: path.join(DATA_DIR, 'vault.json'),
  sdkRoot: SDK_ROOT,
  adbPath: SDK.adb,
  /** setup.json do onboarding; o supervisor do Ollama relê a cada spawn (o binário pode mudar com o daemon no ar). */
  setupPath: SETUP_PATH,
  adbServerPort: 5038,
  mcpAppPackage: 'com.danielealbano.androidremotecontrolmcp.gms.debug',
  targetApp: { package: 'com.instagram.android', versionName: '448.0.0.52.84' },
  ports: { consoleFrom: 5554, consoleMax: 5584, mcpHostFrom: 8080 },
  /** `TAPFLOCK_STEP_BUDGET=0` desliga o orçamento (spec orçamento desligável): a tarefa roda até terminar, pausar ou o kill switch. */
  worker: { stepBudget: stepBudgetFrom(brandEnv(process.env, 'STEP_BUDGET'), 30), keepScreens: 2, qualityFloor: 3 },
  /** Missões (spec missões): orçamento de passos por subtarefa; a missão em si não tem teto. `0` desliga o da subtarefa. */
  mission: { subtaskStepBudget: stepBudgetFrom(brandEnv(process.env, 'MISSION_STEP_BUDGET'), 60), keepScreens: 1 },
  /** Contexto dos modelos locais (Ollama, LM Studio) via `TAPFLOCK_LOCAL_CONTEXT` (spec local: contexto configurável). */
  local: { contextLength: localContextFrom(brandEnv(process.env, 'LOCAL_CONTEXT')) },
  /** Enxame de identidades (spec §4.3 Pacing, inc. 5 §2): starts escalonados com jitter, atraso entre passos e teto de ações/hora por identidade. */
  // Arquivos passados entre aparelhos (spec arquivos): guardados em <dataDir>/files, com teto por arquivo.
  files: { dir: path.join(DATA_DIR, 'files'), maxBytes: 500 * 1024 * 1024, recentLimit: 50 },
  swarm: { staggerMs: 8000, jitterMs: 3000, stepDelayMs: 1500, stepJitterMs: 1000, maxActionsPerHour: 120 },
  /** Ciclo de vida (spec inc. 5 §2): snapshot mais velho que isto exige confirmação humana para restaurar. */
  identity: { restoreUnsafeDays: 14 },
  /** Provisionamento, boot, disco e snapshot (spec inc. 5 §2). */
  avd: {
    home: AVD_HOME,
    /** AVD dourado clonado no provisionamento; `TAPFLOCK_AVD_BASE` troca sem rebuild (ex.: uma base sem conta e desligada). */
    base: pickBaseAvd(brandEnv(process.env, 'AVD_BASE'), AVD_HOME),
    emulatorPath: SDK.emulator,
    bootTimeoutMs: 180_000, diskCacheMs: 60_000, snapshotName: BRAND,
    /** Snapshot salvo antes da troca de nome; a restauração cai nele quando o novo não existe. */
    legacySnapshotName: LEGACY_BRAND,
  },
  /** Miniatura ao vivo (spec inc. 4): captura por identidade, só com alguém assistindo. */
  screen: { intervalMs: 500, retryMs: 5000 },
  /** scrcpy-server empacotado (spec inc. 4 §4.1). O caminho vale a partir de `daemon/src` (vitest) e de `dist-daemon` (build). */
  scrcpy: {
    serverPath: resolveVendor('scrcpy-server-v4.1'), version: '4.1',
    sha256: 'deacb991ed2509715160ffdc7907e47b4160eb30d1566217e9047fd5b8850cae',
    devicePath: `/data/local/tmp/${BRAND}-scrcpy-server.jar`,
    maxSize: 720, maxFps: 30, bitRate: 2_000_000, portFrom: Number(brandEnv(process.env, 'SCRCPY_PORT') ?? 27183), connectTimeoutMs: 5000, retryMs: 5000,
  },
} as const;

/**
 * A chave da Anthropic é opcional: com todos os papéis locais (Ollama) o daemon roda sem ela. Papel na nuvem sem chave
 * falha só na hora de usar, com mensagem clara (líder cai na regra determinística; escalonamento é pulado).
 * Chave presente mas curta demais é erro de digitação e barra a subida.
 */
const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().trim().optional()
    .refine((k) => !k || k.length >= 20, 'ANTHROPIC_API_KEY curta demais: confira o valor no .env (ou deixe vazia para usar só modelos locais)'),
});

export function loadEnv(env: NodeJS.ProcessEnv = process.env): { anthropicApiKey: string } {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join('; '));
  return { anthropicApiKey: parsed.data.ANTHROPIC_API_KEY ?? '' };
}
