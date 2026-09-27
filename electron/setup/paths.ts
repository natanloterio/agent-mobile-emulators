import os from 'node:os';
import path from 'node:path';
import { imageAbi, isWindows, platformId, type PlatformId } from './platform.js';

/** Onde o onboarding lê e instala. Tudo no home da pessoa: nada pede sudo/admin. */
export interface SetupPaths {
  readonly platform: PlatformId;
  readonly dataDir: string; readonly setupFile: string;
  readonly sdkRoot: string; readonly sdkmanager: string; readonly adbBin: string; readonly emulatorBin: string; readonly imageDir: string;
  readonly toolsDir: string; readonly jreDir: string; readonly javaHome: string; readonly javaBin: string; readonly downloadsDir: string;
  readonly ollamaDir: string; readonly ollamaBin: string; readonly ollamaModels: string;
}

/** SDK padrão de cada sistema; mesmas regras do daemon (daemon/src/device/sdk.ts). */
function defaultSdk(env: NodeJS.ProcessEnv, home: string, pl: PlatformId, p: typeof path.posix): string {
  if (pl.startsWith('darwin')) return p.join(home, 'Library', 'Android', 'sdk');
  if (isWindows(pl)) return p.join(env.LOCALAPPDATA || p.join(home, 'AppData', 'Local'), 'Android', 'Sdk');
  return p.join(home, 'Android', 'Sdk');
}

export function resolveSetupPaths(
  env: NodeJS.ProcessEnv = process.env, home: string = os.homedir(), savedSdkRoot: string | null = null,
  platform: PlatformId = platformId() ?? 'linux-x64',
): SetupPaths {
  const win = isWindows(platform);
  const p = win ? path.win32 : path.posix;
  const exe = win ? '.exe' : '';
  const dataDir = env.ENXAME_DATA_DIR || p.join(home, '.local', 'share', 'enxame');
  const toolsDir = p.join(dataDir, 'tools');
  const sdkRoot = savedSdkRoot || env.ANDROID_HOME || env.ANDROID_SDK_ROOT || defaultSdk(env, home, platform, p);
  const jreDir = p.join(toolsDir, 'jre');
  // O JRE do macOS é um bundle: o JAVA_HOME fica em Contents/Home.
  const javaHome = platform.startsWith('darwin') ? p.join(jreDir, 'Contents', 'Home') : jreDir;
  const ollamaDir = p.join(toolsDir, 'ollama');
  // Layout de cada pacote do Ollama: Linux traz bin/ollama; macOS (tgz) e Windows (zip) trazem o binário na raiz.
  const ollamaBin = platform === 'linux-x64' ? p.join(ollamaDir, 'bin', 'ollama') : p.join(ollamaDir, `ollama${exe}`);
  return {
    platform, dataDir, setupFile: p.join(dataDir, 'setup.json'),
    sdkRoot,
    sdkmanager: p.join(sdkRoot, 'cmdline-tools', 'latest', 'bin', win ? 'sdkmanager.bat' : 'sdkmanager'),
    adbBin: p.join(sdkRoot, 'platform-tools', `adb${exe}`),
    emulatorBin: p.join(sdkRoot, 'emulator', `emulator${exe}`),
    imageDir: p.join(sdkRoot, 'system-images', 'android-34', 'google_apis_playstore', imageAbi(platform)),
    toolsDir, jreDir, javaHome, javaBin: p.join(javaHome, 'bin', `java${exe}`),
    downloadsDir: p.join(toolsDir, 'downloads'),
    ollamaDir, ollamaBin,
    ollamaModels: env.OLLAMA_MODELS || p.join(home, '.ollama', 'models'),
  };
}
