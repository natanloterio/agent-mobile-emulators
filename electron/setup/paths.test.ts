import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveSetupPaths } from './paths';

describe('resolveSetupPaths por plataforma', () => {
  it('Linux: padrões de hoje', () => {
    const p = resolveSetupPaths({}, '/home/u', null, 'linux-x64');
    expect(p.dataDir).toBe('/home/u/.local/share/enxame');
    expect(p.sdkRoot).toBe('/home/u/Android/Sdk');
    expect(p.sdkmanager).toBe('/home/u/Android/Sdk/cmdline-tools/latest/bin/sdkmanager');
    expect(p.adbBin).toBe('/home/u/Android/Sdk/platform-tools/adb');
    expect(p.imageDir).toBe('/home/u/Android/Sdk/system-images/android-34/google_apis_playstore/x86_64');
    expect(p.javaBin).toBe('/home/u/.local/share/enxame/tools/jre/bin/java');
    expect(p.ollamaBin).toBe('/home/u/.local/share/enxame/tools/ollama/bin/ollama');
  });
  it('macOS Apple Silicon: SDK em Library, JRE em Contents/Home, imagem arm64', () => {
    const p = resolveSetupPaths({}, '/Users/u', null, 'darwin-arm64');
    expect(p.sdkRoot).toBe('/Users/u/Library/Android/sdk');
    expect(p.javaHome).toBe('/Users/u/.local/share/enxame/tools/jre/Contents/Home');
    expect(p.javaBin).toBe('/Users/u/.local/share/enxame/tools/jre/Contents/Home/bin/java');
    expect(p.imageDir.endsWith('google_apis_playstore/arm64-v8a')).toBe(true);
    expect(p.ollamaBin).toBe('/Users/u/.local/share/enxame/tools/ollama/ollama');
  });
  it('Windows: LOCALAPPDATA, .exe e sdkmanager.bat', () => {
    const p = resolveSetupPaths({ LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'C:\\Users\\u', null, 'win32-x64');
    expect(p.sdkRoot).toBe('C:\\Users\\u\\AppData\\Local\\Android\\Sdk');
    expect(p.sdkmanager).toBe('C:\\Users\\u\\AppData\\Local\\Android\\Sdk\\cmdline-tools\\latest\\bin\\sdkmanager.bat');
    expect(p.adbBin.endsWith('platform-tools\\adb.exe')).toBe(true);
    expect(p.emulatorBin.endsWith('emulator\\emulator.exe')).toBe(true);
    expect(p.javaBin).toBe('C:\\Users\\u\\.local\\share\\enxame\\tools\\jre\\bin\\java.exe');
    expect(p.ollamaBin).toBe('C:\\Users\\u\\.local\\share\\enxame\\tools\\ollama\\ollama.exe');
  });
  it('ENXAME_DATA_DIR, ANDROID_HOME, OLLAMA_MODELS e sdkRoot salvo', () => {
    const p = resolveSetupPaths({ ENXAME_DATA_DIR: '/d', ANDROID_HOME: '/sdk', OLLAMA_MODELS: '/m' }, '/home/u', null, 'linux-x64');
    expect([p.setupFile, p.sdkRoot, p.ollamaModels]).toEqual(['/d/setup.json', '/sdk', '/m']);
    expect(resolveSetupPaths({ ANDROID_HOME: '/sdk' }, '/home/u', '/saved', 'linux-x64').sdkRoot).toBe('/saved');
    expect(path.posix.isAbsolute(p.toolsDir)).toBe(true);
  });
});
