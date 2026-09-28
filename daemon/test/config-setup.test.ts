import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ollamaBinFrom, readSetupPaths, sdkRootFrom } from '../src/config.js';

const none = { sdkRoot: null, ollamaBin: null };

describe('readSetupPaths: caminhos gravados pelo onboarding', () => {
  it('lê sdkRoot e ollamaBin do setup.json', () => {
    const read = () => JSON.stringify({ version: 1, completedAt: null, paths: { sdkRoot: '/opt/sdk', ollamaBin: '/x/ollama' } });
    expect(readSetupPaths('/d/setup.json', read)).toEqual({ sdkRoot: '/opt/sdk', ollamaBin: '/x/ollama' });
  });
  it('arquivo ausente, JSON quebrado ou formato errado: tudo null', () => {
    const missing = () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); };
    expect(readSetupPaths('/d/setup.json', missing)).toEqual(none);
    expect(readSetupPaths('/d/setup.json', () => '{')).toEqual(none);
    expect(readSetupPaths('/d/setup.json', () => '{"paths":{"sdkRoot":3}}')).toEqual(none);
  });
});

describe('sdkRootFrom', () => {
  it('setup.json vence as variáveis de ambiente', () => {
    expect(sdkRootFrom({ sdkRoot: '/opt/sdk', ollamaBin: null }, { ANDROID_HOME: '/env/sdk' }, '/home/u', 'linux')).toBe('/opt/sdk');
  });
  it('ANDROID_HOME, depois ANDROID_SDK_ROOT, depois ~/Android/Sdk; vazio não conta', () => {
    expect(sdkRootFrom(none, { ANDROID_HOME: '/a', ANDROID_SDK_ROOT: '/b' }, '/home/u', 'linux')).toBe('/a');
    expect(sdkRootFrom(none, { ANDROID_HOME: '', ANDROID_SDK_ROOT: '/b' }, '/home/u', 'linux')).toBe('/b');
    expect(sdkRootFrom(none, {}, '/home/u', 'linux')).toBe(path.posix.join('/home/u', 'Android', 'Sdk'));
  });
  it('sem setup.json mantém o padrão de cada SO', () => {
    expect(sdkRootFrom(none, {}, '/Users/u', 'darwin')).toBe('/Users/u/Library/Android/sdk');
    expect(sdkRootFrom(none, { LOCALAPPDATA: 'C:\\L' }, 'C:\\Users\\u', 'win32')).toBe('C:\\L\\Android\\Sdk');
  });
});

describe('ollamaBinFrom', () => {
  it('TAPFLOCK_OLLAMA_BIN, depois setup.json, depois "ollama" do PATH', () => {
    expect(ollamaBinFrom({ sdkRoot: null, ollamaBin: '/s/ollama' }, { TAPFLOCK_OLLAMA_BIN: '/e/ollama' })).toBe('/e/ollama');
    expect(ollamaBinFrom({ sdkRoot: null, ollamaBin: '/s/ollama' }, {})).toBe('/s/ollama');
    expect(ollamaBinFrom(none, {})).toBe('ollama');
  });
});
