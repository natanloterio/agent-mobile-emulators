import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const DATA_DIR = process.env.ENXAME_DATA_DIR ?? path.join(os.homedir(), '.local', 'share', 'enxame');

/** AVD dourado criado a partir da conta1 com ela parada (clone sem conta de terceiro após o primeiro boot). */
export const GOLDEN_AVD = 'enxame_golden';
/** Base de clonagem: `ENXAME_AVD_BASE`, senão a dourada se existir, senão o AVD da conta1 (que precisa estar parado). */
export function pickBaseAvd(envBase: string | undefined, avdHome: string, exists: (p: string) => boolean = existsSync): string {
  if (envBase) return envBase;
  return exists(path.join(avdHome, `${GOLDEN_AVD}.avd`)) ? GOLDEN_AVD : 'mcp_test_playstore';
}
const AVD_HOME = process.env.ANDROID_AVD_HOME ?? path.join(os.homedir(), '.android', 'avd');

/** Orçamento de passos de uma env var: `"0"` desliga (`null` = sem limite); inteiro positivo vale; ausente, vazio, NaN, negativo ou não inteiro caem no `fallback`. */
export function stepBudgetFrom(raw: string | undefined, fallback: number): number | null {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return fallback;
  return n === 0 ? null : n;
}

/** Contexto dos modelos locais via `ENXAME_LOCAL_CONTEXT`: inteiro ≥ 8192 vale; ausente, lixo ou menor cai no padrão 65536 (mais contexto usa mais VRAM). */
export function localContextFrom(raw: string | undefined, fallback = 65536): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 8192 ? n : fallback;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Resolve um arquivo de `daemon/vendor` tanto a partir de `daemon/src` (vitest) quanto de `dist-daemon` (build). */
function resolveVendor(file: string): string {
  const candidates = [path.resolve(HERE, '..', 'daemon', 'vendor', file), path.resolve(HERE, '..', '..', 'daemon', 'vendor', file)];
  return candidates.find((p) => existsSync(p)) ?? candidates[0];
}

export const CONFIG = {
  dataDir: DATA_DIR,
  dbPath: path.join(DATA_DIR, 'enxame.sqlite'),
  daemonInfoPath: path.join(DATA_DIR, 'daemon.json'),
  /** Cofre de segredos do daemon (spec missões §Cofre); a chave fica no chaveiro do SO. */
  vaultPath: path.join(DATA_DIR, 'vault.json'),
  adbPath: '/home/loterio/Android/Sdk/platform-tools/adb',
  adbServerPort: 5038,
  mcpAppPackage: 'com.danielealbano.androidremotecontrolmcp.gms.debug',
  targetApp: { package: 'com.instagram.android', versionName: '448.0.0.52.84' },
  ports: { consoleFrom: 5554, consoleMax: 5584, mcpHostFrom: 8080 },
  /** `ENXAME_STEP_BUDGET=0` desliga o orçamento (spec orçamento desligável): a tarefa roda até terminar, pausar ou o kill switch. */
  worker: { stepBudget: stepBudgetFrom(process.env.ENXAME_STEP_BUDGET, 30), keepScreens: 2, qualityFloor: 3 },
  /** Missões (spec missões): orçamento de passos por subtarefa; a missão em si não tem teto. `0` desliga o da subtarefa. */
  mission: { subtaskStepBudget: stepBudgetFrom(process.env.ENXAME_MISSION_STEP_BUDGET, 60) },
  /** Contexto dos modelos locais (Ollama, LM Studio) via `ENXAME_LOCAL_CONTEXT` (spec local: contexto configurável). */
  local: { contextLength: localContextFrom(process.env.ENXAME_LOCAL_CONTEXT) },
  /** Enxame (spec §4.3 Pacing, inc. 5 §2): starts escalonados com jitter, atraso entre passos e teto de ações/hora por identidade. */
  swarm: { staggerMs: 8000, jitterMs: 3000, stepDelayMs: 1500, stepJitterMs: 1000, maxActionsPerHour: 120 },
  /** Ciclo de vida (spec inc. 5 §2): snapshot mais velho que isto exige confirmação humana para restaurar. */
  identity: { restoreUnsafeDays: 14 },
  /** Provisionamento, boot, disco e snapshot (spec inc. 5 §2). */
  avd: {
    home: AVD_HOME,
    /** AVD dourado clonado no provisionamento; `ENXAME_AVD_BASE` troca sem rebuild (ex.: uma base sem conta e desligada). */
    base: pickBaseAvd(process.env.ENXAME_AVD_BASE, AVD_HOME),
    emulatorPath: '/home/loterio/Android/Sdk/emulator/emulator',
    bootTimeoutMs: 180_000, diskCacheMs: 60_000, snapshotName: 'enxame',
  },
  /** Miniatura ao vivo (spec inc. 4): captura por identidade, só com alguém assistindo. */
  screen: { intervalMs: 500, retryMs: 5000 },
  /** scrcpy-server empacotado (spec inc. 4 §4.1). O caminho vale a partir de `daemon/src` (vitest) e de `dist-daemon` (build). */
  scrcpy: {
    serverPath: resolveVendor('scrcpy-server-v4.1'), version: '4.1',
    sha256: 'deacb991ed2509715160ffdc7907e47b4160eb30d1566217e9047fd5b8850cae',
    devicePath: '/data/local/tmp/enxame-scrcpy-server.jar',
    maxSize: 720, maxFps: 30, bitRate: 2_000_000, portFrom: Number(process.env.ENXAME_SCRCPY_PORT ?? 27183), connectTimeoutMs: 5000, retryMs: 5000,
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
