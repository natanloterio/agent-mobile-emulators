import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

const DATA_DIR = process.env.ENXAME_DATA_DIR ?? path.join(os.homedir(), '.local', 'share', 'enxame');

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
} as const;

const EnvSchema = z.object({ ANTHROPIC_API_KEY: z.string().min(20, 'ANTHROPIC_API_KEY ausente ou curta') });

export function loadEnv(): { anthropicApiKey: string } {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join('; '));
  return { anthropicApiKey: parsed.data.ANTHROPIC_API_KEY };
}
