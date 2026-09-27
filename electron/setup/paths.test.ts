import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveSetupPaths } from './paths.js';

describe('resolveSetupPaths', () => {
  it('padrões dentro de ~/.local/share/enxame e ~/Android/Sdk', () => {
    const p = resolveSetupPaths({}, '/home/u');
    expect(p.dataDir).toBe('/home/u/.local/share/enxame');
    expect(p.setupFile).toBe('/home/u/.local/share/enxame/setup.json');
    expect(p.sdkRoot).toBe(path.join('/home/u', 'Android', 'Sdk'));
    expect(p.jreDir).toBe('/home/u/.local/share/enxame/tools/jre');
    expect(p.ollamaBin).toBe('/home/u/.local/share/enxame/tools/ollama/bin/ollama');
    expect(p.ollamaModels).toBe('/home/u/.ollama/models');
  });
  it('ENXAME_DATA_DIR, ANDROID_HOME e OLLAMA_MODELS mudam os lugares; sdkRoot salvo vence', () => {
    const p = resolveSetupPaths({ ENXAME_DATA_DIR: '/d', ANDROID_HOME: '/sdk', OLLAMA_MODELS: '/m' }, '/home/u');
    expect(p.setupFile).toBe('/d/setup.json');
    expect(p.sdkRoot).toBe('/sdk');
    expect(p.ollamaModels).toBe('/m');
    expect(resolveSetupPaths({ ANDROID_HOME: '/sdk' }, '/home/u', '/saved').sdkRoot).toBe('/saved');
  });
});
