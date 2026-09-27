import { describe, expect, it } from 'vitest';
import { createI18n, PT } from '../i18n/translate';
import type { ModelEntry, RuntimeInfo } from '../live/types';
import { cardError, localSelect, modelChoice, parseOptionValue, roleRuntime, runtimeLines } from './localModels';

const RUNTIMES: readonly RuntimeInfo[] = [
  { kind: 'ollama', label: 'Ollama', endpoint: 'http://127.0.0.1:11434/v1', installed: true, running: false, error: 'Ollama parado — sem resposta em :11434' },
  { kind: 'lmstudio', label: 'LM Studio', endpoint: 'http://127.0.0.1:1234/v1', installed: false, running: false, error: null },
];
const ENTRIES: readonly ModelEntry[] = [
  { id: 'qwen3:8b', runtime: 'ollama', label: 'qwen3:8b', sizeBytes: 5.23e9, loaded: null, toolUse: true },
  { id: 'qwen/qwen3-8b', runtime: 'lmstudio', label: 'Qwen3 8B', sizeBytes: null, loaded: true, toolUse: true },
  { id: 'gemma4:12b', runtime: 'ollama', label: 'gemma4:12b', sizeBytes: 8e9, loaded: false, toolUse: null },
];
const catalog = { entries: ENTRIES, runtimes: RUNTIMES };

describe('roleRuntime', () => {
  it('usa o runtime do snapshot; sem ele, a porta 1234 indica LM Studio e o resto Ollama', () => {
    expect(roleRuntime('lmstudio', 'http://127.0.0.1:11434/v1')).toBe('lmstudio');
    expect(roleRuntime(null, 'http://127.0.0.1:1234/v1')).toBe('lmstudio');
    expect(roleRuntime(undefined, 'http://localhost:11434/v1')).toBe('ollama');
  });
});

describe('localSelect', () => {
  it('agrupa por runtime (Ollama antes de LM Studio) com tamanho em GB e marcador de carregado', () => {
    const v = localSelect(catalog, 'ollama', 'qwen3:8b', PT);
    expect(v.value).toBe('ollama/qwen3:8b');
    expect(v.orphan).toBeNull();
    expect(v.groups).toEqual([
      { runtime: 'ollama', label: 'Ollama', options: [
        { value: 'ollama/qwen3:8b', label: 'qwen3:8b · 5,2 GB' },
        { value: 'ollama/gemma4:12b', label: 'gemma4:12b · 8,0 GB' },
      ] },
      { runtime: 'lmstudio', label: 'LM Studio', options: [{ value: 'lmstudio/qwen/qwen3-8b', label: 'Qwen3 8B · carregado' }] },
    ]);
  });
  it('no inglês o decimal e o marcador seguem o idioma', () => {
    const v = localSelect(catalog, 'ollama', 'qwen3:8b', createI18n('en'));
    expect(v.groups[0].options[0].label).toBe('qwen3:8b · 5.2 GB');
    expect(v.groups[1].options[0].label).toBe('Qwen3 8B · loaded');
  });
  it('modelo atual fora da lista vira opção "(atual)"; mesmo id em outro runtime não conta', () => {
    const v = localSelect(catalog, 'lmstudio', 'qwen3:8b', PT);
    expect(v.orphan).toEqual({ value: 'lmstudio/qwen3:8b', label: 'qwen3:8b (atual)' });
    expect(v.value).toBe('lmstudio/qwen3:8b');
  });
  it('runtime sem entries não gera grupo vazio', () => {
    expect(localSelect({ entries: [ENTRIES[1]], runtimes: RUNTIMES }, 'lmstudio', 'qwen/qwen3-8b', PT).groups.map((g) => g.runtime)).toEqual(['lmstudio']);
  });
});

describe('modelChoice', () => {
  it('mesmo runtime: só o modelo; outro runtime: runtime e modelo', () => {
    expect(parseOptionValue('lmstudio/qwen/qwen3-8b')).toEqual({ runtime: 'lmstudio', model: 'qwen/qwen3-8b' });
    expect(modelChoice('ollama/gemma4:12b', 'ollama')).toEqual({ model: 'gemma4:12b' });
    expect(modelChoice('lmstudio/qwen/qwen3-8b', 'ollama')).toEqual({ runtime: 'lmstudio', model: 'qwen/qwen3-8b' });
  });
});

describe('runtimeLines', () => {
  it('uma linha por runtime: no ar, parado ou não instalado, com o erro do daemon como vem', () => {
    const up = { ...RUNTIMES[1], installed: true, running: true };
    expect(runtimeLines([...RUNTIMES, up], PT)).toEqual([
      { kind: 'ollama', text: 'Ollama · parado — o próximo teste ou objetivo o sobe', error: 'Ollama parado — sem resposta em :11434' },
      { kind: 'lmstudio', text: 'LM Studio · não instalado', error: null },
      { kind: 'lmstudio', text: 'LM Studio · no ar', error: null },
    ]);
  });
});

describe('cardError', () => {
  it('erro de PUT sempre aparece; erro de carga igual ao de um runtime some do card (já está na linha dele)', () => {
    expect(cardError('frota ocupada', 'frota ocupada', RUNTIMES)).toBe('frota ocupada');
    expect(cardError(RUNTIMES[0].error, null, RUNTIMES)).toBeNull();
    expect(cardError('fetch failed', null, RUNTIMES)).toBe('fetch failed');
    expect(cardError('Ollama parado', null, null)).toBe('Ollama parado');
  });
});
