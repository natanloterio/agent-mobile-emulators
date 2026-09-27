import type { Checksum } from './download.js';
import type { PlatformId } from './platform.js';

export interface Pinned {
  readonly file: string; readonly url: string; readonly checksum: Checksum; readonly sizeMb: number;
  readonly format: 'zip' | 'tar.gz' | 'tar.zst';
}

const GOOGLE = 'https://dl.google.com/android/repository/';
const TEMURIN = 'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.20.1%2B1/';
const OLLAMA = 'https://github.com/ollama/ollama/releases/download/v0.34.4/';

const pin = (base: string, file: string, algo: Checksum['algo'], hex: string, sizeMb: number, format: Pinned['format']): Pinned =>
  ({ file, url: `${base}${file}`, checksum: { algo, hex }, sizeMb, format });

/**
 * Versões fixadas (spec lançamento §2). Para atualizar: arquivo, checksum e tamanho da fonte oficial
 * (repository2-3.xml do Google, API da Adoptium, sha256sum.txt da release do Ollama).
 */
const TABLE: Readonly<Record<PlatformId, { readonly jre: Pinned; readonly cmdlineTools: Pinned; readonly ollama: Pinned }>> = {
  'linux-x64': {
    cmdlineTools: pin(GOOGLE, 'commandlinetools-linux-16111833_latest.zip', 'sha1', 'e025545c62a8e64c7559119566a569fb1dec5f60', 181, 'zip'),
    jre: pin(TEMURIN, 'OpenJDK17U-jre_x64_linux_hotspot_17.0.20.1_1.tar.gz', 'sha256', '0b2b640e3046b64c8ec504de0ab9d91bb5610182bda21fad454681ce54d45a62', 47, 'tar.gz'),
    ollama: pin(OLLAMA, 'ollama-linux-amd64.tar.zst', 'sha256', 'c238986e61d40c0cc5f4a9b9e40b9eea104350b77efa34741fc134e105cb9533', 1428, 'tar.zst'),
  },
  'darwin-x64': {
    cmdlineTools: pin(GOOGLE, 'commandlinetools-mac_x86_64-16111833_latest.zip', 'sha1', '112cf9618794a997ff273537d55bee02c22abffe', 156, 'zip'),
    jre: pin(TEMURIN, 'OpenJDK17U-jre_x64_mac_hotspot_17.0.20.1_1.tar.gz', 'sha256', '333cb81123c36568586646c73c8fa2326dab8badc43f5ea388a90fff59c9df27', 38, 'tar.gz'),
    ollama: pin(OLLAMA, 'ollama-darwin.tgz', 'sha256', 'e9c8fddaab5f48f47f2c4ae3d23d0732f5182417125353faeed2188e34a22799', 160, 'tar.gz'),
  },
  'darwin-arm64': {
    cmdlineTools: pin(GOOGLE, 'commandlinetools-mac_arm64-16111833_latest.zip', 'sha1', 'ad03dc49bfacfd52c110b14104ea548b8a07e830', 155, 'zip'),
    jre: pin(TEMURIN, 'OpenJDK17U-jre_aarch64_mac_hotspot_17.0.20.1_1.tar.gz', 'sha256', '190480874ccceb358cbc840393207f77ac3e63a4c5f8129d0e23e9518b96ad05', 43, 'tar.gz'),
    ollama: pin(OLLAMA, 'ollama-darwin.tgz', 'sha256', 'e9c8fddaab5f48f47f2c4ae3d23d0732f5182417125353faeed2188e34a22799', 160, 'tar.gz'),
  },
  'win32-x64': {
    cmdlineTools: pin(GOOGLE, 'commandlinetools-win-16111833_latest.zip', 'sha1', '57d04f2d75eb8e8fffc5000a987e5de4b5a63e9d', 155, 'zip'),
    jre: pin(TEMURIN, 'OpenJDK17U-jre_x64_windows_hotspot_17.0.20.1_1.zip', 'sha256', 'bc21a93923103cdaac93ee337b0ae4365e739fde36df823dd456bc67c8a9d352', 44, 'zip'),
    ollama: pin(OLLAMA, 'ollama-windows-amd64.zip', 'sha256', '535193f38f3344e5b08f5d1c171c31ce11aa17f0124ff69ae26d8ec7fe06fa62', 1461, 'zip'),
  },
};

export const artifactsFor = (p: PlatformId) => TABLE[p];

/** Download estimado de cada item (MB decimais). `sdk` = JRE + cmdline-tools; `jreOnly` quando as tools já existem. */
export function sizesFor(p: PlatformId): { readonly sdk: number; readonly jreOnly: number; readonly adb: number; readonly emu: number; readonly img: number; readonly ollama: number } {
  const a = TABLE[p];
  return { sdk: a.jre.sizeMb + a.cmdlineTools.sizeMb, jreOnly: a.jre.sizeMb, adb: 14, emu: 380, img: 1600, ollama: a.ollama.sizeMb };
}
