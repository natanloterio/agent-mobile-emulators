import { describe, expect, it } from 'vitest';
import { artifactsFor, sizesFor } from './artifacts';

describe('artifactsFor: versões fixadas da spec', () => {
  it('Linux', () => {
    const a = artifactsFor('linux-x64');
    expect(a.cmdlineTools).toMatchObject({ file: 'commandlinetools-linux-16111833_latest.zip', format: 'zip', checksum: { algo: 'sha1', hex: 'e025545c62a8e64c7559119566a569fb1dec5f60' }, sizeMb: 181 });
    expect(a.jre).toMatchObject({ file: 'OpenJDK17U-jre_x64_linux_hotspot_17.0.20.1_1.tar.gz', format: 'tar.gz', sizeMb: 47 });
    expect(a.ollama).toMatchObject({ file: 'ollama-linux-amd64.tar.zst', format: 'tar.zst', sizeMb: 1428 });
  });
  it('macOS Intel e Apple Silicon', () => {
    expect(artifactsFor('darwin-x64').cmdlineTools.checksum.hex).toBe('112cf9618794a997ff273537d55bee02c22abffe');
    expect(artifactsFor('darwin-arm64').cmdlineTools.checksum.hex).toBe('ad03dc49bfacfd52c110b14104ea548b8a07e830');
    expect(artifactsFor('darwin-x64').jre.checksum.hex).toBe('333cb81123c36568586646c73c8fa2326dab8badc43f5ea388a90fff59c9df27');
    expect(artifactsFor('darwin-arm64').jre.checksum.hex).toBe('190480874ccceb358cbc840393207f77ac3e63a4c5f8129d0e23e9518b96ad05');
    expect(artifactsFor('darwin-arm64').ollama).toMatchObject({ file: 'ollama-darwin.tgz', format: 'tar.gz', sizeMb: 160 });
  });
  it('Windows', () => {
    const a = artifactsFor('win32-x64');
    expect(a.cmdlineTools.checksum.hex).toBe('57d04f2d75eb8e8fffc5000a987e5de4b5a63e9d');
    expect(a.jre).toMatchObject({ file: 'OpenJDK17U-jre_x64_windows_hotspot_17.0.20.1_1.zip', format: 'zip' });
    expect(a.ollama).toMatchObject({ file: 'ollama-windows-amd64.zip', format: 'zip', sizeMb: 1461 });
  });
  it('URLs montadas da fonte oficial', () => {
    const a = artifactsFor('win32-x64');
    expect(a.cmdlineTools.url).toBe('https://dl.google.com/android/repository/commandlinetools-win-16111833_latest.zip');
    expect(a.jre.url).toBe('https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.20.1%2B1/OpenJDK17U-jre_x64_windows_hotspot_17.0.20.1_1.zip');
    expect(a.ollama.url).toBe('https://github.com/ollama/ollama/releases/download/v0.34.4/ollama-windows-amd64.zip');
  });
});

describe('sizesFor', () => {
  it('sdk = JRE + cmdline-tools; ollama pelo pacote da plataforma', () => {
    expect(sizesFor('linux-x64')).toEqual({ sdk: 228, jreOnly: 47, adb: 14, emu: 380, img: 1600, ollama: 1428 });
    expect(sizesFor('darwin-arm64')).toMatchObject({ sdk: 198, jreOnly: 43, ollama: 160 });
    expect(sizesFor('win32-x64')).toMatchObject({ sdk: 199, jreOnly: 44, ollama: 1461 });
  });
});
