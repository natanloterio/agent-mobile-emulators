import { describe, expect, it } from 'vitest';
import { resolveSetupPaths } from './paths.js';
import { listLocalModels, nodeMajor, parseOllamaVersion, parseSourceProperties, probeDeps, type ProbeDeps } from './probe.js';

const paths = resolveSetupPaths({}, '/home/u');
const SDK = paths.sdkRoot;
const IMG = `${SDK}/system-images/android-34/google_apis_playstore/x86_64`;

function fake(o: { files?: string[]; rw?: string[]; texts?: Record<string, string>; exec?: Record<string, string>; dirs?: Record<string, string[]>; keyring?: boolean }): ProbeDeps {
  const files = new Set(o.files ?? []);
  return {
    exists: async (p) => files.has(p),
    canReadWrite: async (p) => (o.rw ?? []).includes(p),
    readText: async (p) => o.texts?.[p] ?? null,
    exec: async (cmd, args) => o.exec?.[`${cmd} ${args.join(' ')}`] ?? null,
    listDir: async (p) => o.dirs?.[p] ?? [],
    keyringOk: async () => o.keyring ?? true,
  };
}

const allInstalled = fake({
  files: [`${SDK}/cmdline-tools/latest/bin/sdkmanager`, `${SDK}/platform-tools/adb`, `${SDK}/emulator/emulator`, `${IMG}/system.img`, '/dev/kvm'],
  rw: ['/dev/kvm'],
  texts: {
    [`${SDK}/cmdline-tools/latest/source.properties`]: 'Pkg.Revision=19.0\n',
    [`${SDK}/platform-tools/source.properties`]: 'Pkg.UserSrc=false\nPkg.Revision=37.0.0\n',
    [`${SDK}/emulator/source.properties`]: 'Pkg.Revision=35.3.11\n',
    [`${IMG}/source.properties`]: 'Pkg.Revision=14\n',
  },
  exec: { 'node --version': 'v26.0.0\n', 'ollama --version': 'Warning: could not connect to a running Ollama instance\nWarning: client version is 0.12.3\n' },
  dirs: { '/home/u/.ollama/models/manifests/registry.ollama.ai/library': ['gpt-oss'], '/home/u/.ollama/models/manifests/registry.ollama.ai/library/gpt-oss': ['20b'] },
});

describe('parsers', () => {
  it('source.properties, node e ollama', () => {
    expect(parseSourceProperties('Pkg.UserSrc=false\nPkg.Revision=37.0.0\n')).toBe('37.0.0');
    expect(parseSourceProperties('nada')).toBeNull();
    expect(nodeMajor('v26.0.0\n')).toBe(26);
    expect(nodeMajor(null)).toBeNull();
    expect(parseOllamaVersion('ollama version is 0.34.4')).toBe('0.34.4');
    expect(parseOllamaVersion(null)).toBeNull();
  });
});

describe('probeDeps', () => {
  it('máquina já usada: tudo ok, com versões, e o Ollama do PATH', async () => {
    const r = await probeDeps(paths, allInstalled);
    expect(r.deps.map((d) => [d.id, d.state, d.version])).toEqual([
      ['node', 'ok', '26.0.0'], ['sdk', 'ok', '19.0'], ['adb', 'ok', '37.0.0'], ['emu', 'ok', '35.3.11'],
      ['img', 'ok', '14'], ['kvm', 'ok', '/dev/kvm'], ['ollama', 'ok', '0.12.3'], ['keyring', 'ok', null],
    ]);
    expect(r.ollamaBin).toBe('ollama');
    expect(r.localModels).toEqual(['gpt-oss:20b']);
  });
  it('máquina limpa: SDK e Ollama para instalar com tamanho; Node velho, KVM sem grupo e chaveiro trancado pedem a pessoa', async () => {
    const r = await probeDeps(paths, fake({ files: ['/dev/kvm'], exec: { 'node --version': 'v20.18.0' }, keyring: false }));
    const by = Object.fromEntries(r.deps.map((d) => [d.id, d]));
    expect(by.node).toMatchObject({ state: 'user', fix: 'node-missing' });
    expect(by.sdk).toMatchObject({ state: 'todo', sizeMb: 228 });
    expect(by.img).toMatchObject({ state: 'todo', sizeMb: 1600 });
    expect(by.kvm).toMatchObject({ state: 'user', fix: 'kvm-group' });
    expect(by.ollama).toMatchObject({ state: 'todo', sizeMb: 1428 });
    expect(by.keyring).toMatchObject({ state: 'user', fix: 'keyring-locked' });
    expect(r.ollamaBin).toBeNull();
  });
  it('sem /dev/kvm: virtualização desligada na BIOS', async () => {
    const r = await probeDeps(paths, fake({}));
    expect(r.deps.find((d) => d.id === 'kvm')).toMatchObject({ state: 'user', fix: 'kvm-bios' });
  });
  it('Ollama instalado pelo Enxame tem preferência sobre o do PATH', async () => {
    const r = await probeDeps(paths, fake({ exec: { [`${paths.ollamaBin} --version`]: 'ollama version is 0.34.4', 'ollama --version': 'ollama version is 0.12.3' } }));
    expect(r.ollamaBin).toBe(paths.ollamaBin);
    expect(r.deps.find((d) => d.id === 'ollama')?.version).toBe('0.34.4');
  });
});

describe('listLocalModels', () => {
  it('nome:tag de cada manifesto, ordenado; diretório ausente = nenhum', async () => {
    const lib = '/m/manifests/registry.ollama.ai/library';
    const d = fake({ dirs: { [lib]: ['qwen3', 'gpt-oss'], [`${lib}/qwen3`]: ['14b', '32b'], [`${lib}/gpt-oss`]: ['20b'] } });
    expect(await listLocalModels('/m', d)).toEqual(['gpt-oss:20b', 'qwen3:14b', 'qwen3:32b']);
    expect(await listLocalModels('/vazio', d)).toEqual([]);
  });
});
