import { describe, expect, it } from 'vitest';
import { sdkPaths, sdkRoot } from '../src/device/sdk.js';

describe('Android SDK por sistema operacional', () => {
  it('ANDROID_HOME tem prioridade, depois ANDROID_SDK_ROOT', () => {
    expect(sdkRoot({ ANDROID_HOME: '/opt/sdk', ANDROID_SDK_ROOT: '/outro' }, 'linux', '/home/u')).toBe('/opt/sdk');
    expect(sdkRoot({ ANDROID_SDK_ROOT: '/outro' }, 'darwin', '/Users/u')).toBe('/outro');
    expect(sdkRoot({ ANDROID_HOME: '  ' }, 'linux', '/home/u')).toBe('/home/u/Android/Sdk');
  });
  it('sem variável: o local padrão do Android Studio em cada SO', () => {
    expect(sdkRoot({}, 'linux', '/home/u')).toBe('/home/u/Android/Sdk');
    expect(sdkRoot({}, 'darwin', '/Users/u')).toBe('/Users/u/Library/Android/sdk');
    expect(sdkRoot({ LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'win32', 'C:\\Users\\u')).toBe('C:\\Users\\u\\AppData\\Local\\Android\\Sdk');
    expect(sdkRoot({}, 'win32', 'C:\\Users\\u')).toBe('C:\\Users\\u\\AppData\\Local\\Android\\Sdk');
  });
  it('adb e emulator com .exe só no Windows, no separador do SO', () => {
    expect(sdkPaths({}, 'linux', '/home/u')).toEqual({ adb: '/home/u/Android/Sdk/platform-tools/adb', emulator: '/home/u/Android/Sdk/emulator/emulator' });
    expect(sdkPaths({}, 'darwin', '/Users/u')).toEqual({
      adb: '/Users/u/Library/Android/sdk/platform-tools/adb', emulator: '/Users/u/Library/Android/sdk/emulator/emulator',
    });
    expect(sdkPaths({ ANDROID_HOME: 'D:\\sdk' }, 'win32', 'C:\\Users\\u')).toEqual({ adb: 'D:\\sdk\\platform-tools\\adb.exe', emulator: 'D:\\sdk\\emulator\\emulator.exe' });
  });
  it('raiz preferida (setup.json) vem antes do ambiente, mantendo o .exe do Windows', () => {
    expect(sdkRoot({ ANDROID_HOME: '/env' }, 'linux', '/home/u', '/setup/sdk')).toBe('/setup/sdk');
    expect(sdkRoot({ ANDROID_HOME: '/env' }, 'linux', '/home/u', null)).toBe('/env');
    expect(sdkPaths({}, 'win32', 'C:\\Users\\u', 'E:\\sdk')).toEqual({ adb: 'E:\\sdk\\platform-tools\\adb.exe', emulator: 'E:\\sdk\\emulator\\emulator.exe' });
  });
});
