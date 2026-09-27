import path from 'node:path';

type Env = Readonly<Record<string, string | undefined>>;

/** Caminhos no formato do SO alvo (testável em qualquer host). */
const pathFor = (platform: NodeJS.Platform) => (platform === 'win32' ? path.win32 : path.posix);
const nonEmpty = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

/**
 * Raiz do Android SDK: `ANDROID_HOME`, senão `ANDROID_SDK_ROOT` (nome antigo), senão onde o Android Studio instala
 * em cada SO: `~/Android/Sdk` (Linux), `~/Library/Android/sdk` (macOS), `%LOCALAPPDATA%\Android\Sdk` (Windows).
 */
export function sdkRoot(env: Env, platform: NodeJS.Platform, home: string): string {
  const fromEnv = nonEmpty(env.ANDROID_HOME) ?? nonEmpty(env.ANDROID_SDK_ROOT);
  if (fromEnv) return fromEnv;
  const p = pathFor(platform);
  if (platform === 'darwin') return p.join(home, 'Library', 'Android', 'sdk');
  if (platform === 'win32') return p.join(nonEmpty(env.LOCALAPPDATA) ?? p.join(home, 'AppData', 'Local'), 'Android', 'Sdk');
  return p.join(home, 'Android', 'Sdk');
}

/** Binários do SDK que o daemon usa; `.exe` no Windows. */
export function sdkPaths(env: Env, platform: NodeJS.Platform, home: string): { adb: string; emulator: string } {
  const p = pathFor(platform);
  const root = sdkRoot(env, platform, home);
  const exe = platform === 'win32' ? '.exe' : '';
  return { adb: p.join(root, 'platform-tools', `adb${exe}`), emulator: p.join(root, 'emulator', `emulator${exe}`) };
}
