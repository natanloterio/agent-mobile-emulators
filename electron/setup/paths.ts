import os from 'node:os';
import path from 'node:path';

/** Onde o onboarding lê e instala. Tudo no home da pessoa: nada pede sudo. */
export interface SetupPaths {
  readonly dataDir: string;
  readonly setupFile: string;
  readonly sdkRoot: string;
  readonly toolsDir: string;
  readonly jreDir: string;
  readonly downloadsDir: string;
  readonly ollamaDir: string;
  readonly ollamaBin: string;
  readonly ollamaModels: string;
}

/** Mesmas regras do daemon (daemon/src/config.ts: sdkRootFrom); `savedSdkRoot` vem de um setup.json anterior. */
export function resolveSetupPaths(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir(), savedSdkRoot: string | null = null): SetupPaths {
  const dataDir = env.ENXAME_DATA_DIR || path.join(home, '.local', 'share', 'enxame');
  const toolsDir = path.join(dataDir, 'tools');
  const ollamaDir = path.join(toolsDir, 'ollama');
  return {
    dataDir,
    setupFile: path.join(dataDir, 'setup.json'),
    sdkRoot: savedSdkRoot || env.ANDROID_HOME || env.ANDROID_SDK_ROOT || path.join(home, 'Android', 'Sdk'),
    toolsDir,
    jreDir: path.join(toolsDir, 'jre'),
    downloadsDir: path.join(toolsDir, 'downloads'),
    ollamaDir,
    ollamaBin: path.join(ollamaDir, 'bin', 'ollama'),
    ollamaModels: env.OLLAMA_MODELS || path.join(home, '.ollama', 'models'),
  };
}
