import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const DATA_DIR = process.env.ENXAME_DATA_DIR ?? path.join(os.homedir(), '.local', 'share', 'enxame');

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
  adbPath: '/home/loterio/Android/Sdk/platform-tools/adb',
  adbServerPort: 5038,
  mcpAppPackage: 'com.danielealbano.androidremotecontrolmcp.gms.debug',
  targetApp: { package: 'com.instagram.android', versionName: '448.0.0.52.84' },
  ports: { consoleFrom: 5554, consoleMax: 5584, mcpHostFrom: 8080 },
  worker: { stepBudget: 30, keepScreens: 2, qualityFloor: 3 },
  /** Miniatura ao vivo (spec inc. 4): captura por identidade, só com alguém assistindo. */
  screen: { intervalMs: 500, retryMs: 5000 },
  /** scrcpy-server empacotado (spec inc. 4 §4.1). O caminho vale a partir de `daemon/src` (vitest) e de `dist-daemon` (build). */
  scrcpy: {
    serverPath: resolveVendor('scrcpy-server-v4.1'), version: '4.1',
    sha256: 'deacb991ed2509715160ffdc7907e47b4160eb30d1566217e9047fd5b8850cae',
    devicePath: '/data/local/tmp/enxame-scrcpy-server.jar',
    maxSize: 720, maxFps: 30, bitRate: 2_000_000, portFrom: 27183, connectTimeoutMs: 5000, retryMs: 5000,
  },
} as const;

const EnvSchema = z.object({ ANTHROPIC_API_KEY: z.string().min(20, 'ANTHROPIC_API_KEY ausente ou curta') });

export function loadEnv(): { anthropicApiKey: string } {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join('; '));
  return { anthropicApiKey: parsed.data.ANTHROPIC_API_KEY };
}
