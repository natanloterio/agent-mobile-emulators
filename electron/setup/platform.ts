import os from 'node:os';

/** Plataformas onde o onboarding verifica e instala (spec lançamento §2). */
export type PlatformId = 'linux-x64' | 'darwin-x64' | 'darwin-arm64' | 'win32-x64';
const SUPPORTED: readonly PlatformId[] = ['linux-x64', 'darwin-x64', 'darwin-arm64', 'win32-x64'];

export function platformId(platform: string = process.platform, arch: string = os.arch()): PlatformId | null {
  const id = `${platform}-${arch}`;
  return (SUPPORTED as readonly string[]).includes(id) ? (id as PlatformId) : null;
}

export const isWindows = (p: PlatformId): boolean => p === 'win32-x64';
export const imageAbi = (p: PlatformId): 'arm64-v8a' | 'x86_64' => (p === 'darwin-arm64' ? 'arm64-v8a' : 'x86_64');
/** Pacote do sdkmanager da imagem Android 14 com Google Play na arquitetura da máquina. */
export const systemImage = (p: PlatformId): string => `system-images;android-34;google_apis_playstore;${imageAbi(p)}`;
