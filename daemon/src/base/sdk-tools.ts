import path from 'node:path';

const pathFor = (platform: NodeJS.Platform) => (platform === 'win32' ? path.win32 : path.posix);

/** `avdmanager` das cmdline-tools que o onboarding instala (electron/setup/paths.ts põe o sdkmanager no mesmo `bin`). */
export function avdmanagerPath(sdkRoot: string, platform: NodeJS.Platform): string {
  return pathFor(platform).join(sdkRoot, 'cmdline-tools', 'latest', 'bin', platform === 'win32' ? 'avdmanager.bat' : 'avdmanager');
}

/** JAVA_HOME do JRE que o onboarding baixa (electron/setup/paths.ts); `null` quando não há (cai no Java do sistema). */
export function jreHome(dataDir: string, platform: NodeJS.Platform, exists: (p: string) => boolean): string | null {
  const p = pathFor(platform);
  const home = platform === 'darwin' ? p.join(dataDir, 'tools', 'jre', 'Contents', 'Home') : p.join(dataDir, 'tools', 'jre');
  return exists(home) ? home : null;
}

/** Mesma imagem que o onboarding instala (electron/setup/platform.ts). */
export function systemImageId(platform: NodeJS.Platform, arch: string): string {
  const abi = platform === 'darwin' && arch === 'arm64' ? 'arm64-v8a' : 'x86_64';
  return `system-images;android-34;google_apis_playstore;${abi}`;
}

/** `avdmanager create avd` sem interação: o "no" responde à pergunta do perfil de hardware personalizado. */
export function createAvdCommand(name: string, image: string): { readonly args: readonly string[]; readonly stdin: string } {
  return { args: ['create', 'avd', '-n', name, '-k', image, '-d', 'pixel_6'], stdin: 'no\n' };
}

const q = (arg: string): string => (arg.includes(' ') ? `"${arg}"` : arg);

/**
 * Como chamar o avdmanager. No Windows ele é um .bat, que só roda pelo cmd: `/d /s /c ""<bat>" args"` com `verbatim`
 * (mesmo cuidado do sdkmanager em electron/setup/runners.ts) não quebra um caminho com espaço (`C:\Users\John Doe\…`).
 */
export function avdmanagerSpawn(bin: string, args: readonly string[], platform: NodeJS.Platform): { file: string; args: readonly string[]; verbatim: boolean } {
  if (platform !== 'win32') return { file: bin, args, verbatim: false };
  return { file: 'cmd', args: ['/d', '/s', '/c', `""${bin}" ${args.map(q).join(' ')}"`], verbatim: true };
}
