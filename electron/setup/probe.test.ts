import { describe, expect, it } from 'vitest';
import { resolveSetupPaths } from './paths.js';
import { javaMajor, listLocalModels, parseOllamaVersion, parseSourceProperties, probeDeps, WHPX_QUERY, type ProbeDeps } from './probe.js';

const paths = resolveSetupPaths({}, '/home/u', null, 'linux-x64');
const SDK = paths.sdkRoot;

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
  files: [paths.sdkmanager, paths.adbBin, paths.emulatorBin, `${paths.imageDir}/system.img`, '/dev/kvm'],
  rw: ['/dev/kvm'],
  texts: {
    [`${SDK}/cmdline-tools/latest/source.properties`]: 'Pkg.Revision=19.0\n',
    [`${SDK}/platform-tools/source.properties`]: 'Pkg.UserSrc=false\nPkg.Revision=37.0.0\n',
    [`${SDK}/emulator/source.properties`]: 'Pkg.Revision=35.3.11\n',
    [`${paths.imageDir}/source.properties`]: 'Pkg.Revision=14\n',
  },
  exec: { 'java -version': 'openjdk version "21.0.4" 2024-07-16\nOpenJDK Runtime Environment\n', 'ollama --version': 'Warning: could not connect to a running Ollama instance\nWarning: client version is 0.12.3\n' },
  dirs: { '/home/u/.ollama/models/manifests/registry.ollama.ai/library': ['gpt-oss'], '/home/u/.ollama/models/manifests/registry.ollama.ai/library/gpt-oss': ['20b'] },
});

describe('parsers', () => {
  it('source.properties e ollama', () => {
    expect(parseSourceProperties('Pkg.UserSrc=false\nPkg.Revision=37.0.0\n')).toBe('37.0.0');
    expect(parseSourceProperties('nada')).toBeNull();
    expect(parseOllamaVersion('ollama version is 0.34.4')).toBe('0.34.4');
    expect(parseOllamaVersion(null)).toBeNull();
  });
  it('versão maior do java -version (stderr)', () => {
    expect(javaMajor('openjdk version "17.0.12" 2024-07-16')).toBe(17);
    expect(javaMajor('openjdk version "21" 2023-09-19')).toBe(21);
    expect(javaMajor('java version "1.8.0_392"')).toBe(8);
    expect(javaMajor(null)).toBeNull();
    expect(javaMajor('bash: java: command not found')).toBeNull();
  });
});

describe('probeDeps', () => {
  it('máquina já usada: tudo ok, com versões, e o Ollama do PATH', async () => {
    const r = await probeDeps(paths, allInstalled);
    expect(r.deps.map((d) => [d.id, d.state, d.version])).toEqual([
      ['sdk', 'ok', '19.0'], ['adb', 'ok', '37.0.0'], ['emu', 'ok', '35.3.11'],
      ['img', 'ok', '14'], ['kvm', 'ok', '/dev/kvm'], ['ollama', 'ok', '0.12.3'], ['keyring', 'ok', null],
    ]);
    expect(r.ollamaBin).toBe('ollama');
    expect(r.localModels).toEqual(['gpt-oss:20b']);
  });
  it('máquina limpa: SDK e Ollama para instalar com tamanho; KVM sem grupo e chaveiro trancado pedem a pessoa', async () => {
    const r = await probeDeps(paths, fake({ files: ['/dev/kvm'], keyring: false }));
    const by = Object.fromEntries(r.deps.map((d) => [d.id, d]));
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

describe('probeDeps: Java do sdkmanager', () => {
  const sdkOf = async (d: ProbeDeps) => (await probeDeps(paths, d)).deps.find((x) => x.id === 'sdk');
  it('sdkmanager sem JRE do Enxame e sem Java ≥ 17: sdk fica para instalar (só o JRE)', async () => {
    expect(await sdkOf(fake({ files: [paths.sdkmanager] }))).toMatchObject({ state: 'todo', sizeMb: 47 });
    expect(await sdkOf(fake({ files: [paths.sdkmanager], exec: { 'java -version': 'java version "1.8.0_392"' } }))).toMatchObject({ state: 'todo' });
  });
  it('sdkmanager com Java ≥ 17 no PATH ou com o JRE do Enxame: ok', async () => {
    expect(await sdkOf(fake({ files: [paths.sdkmanager], exec: { 'java -version': 'openjdk version "17.0.12"' } }))).toMatchObject({ state: 'ok' });
    expect(await sdkOf(fake({ files: [paths.sdkmanager, paths.javaBin] }))).toMatchObject({ state: 'ok' });
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

describe('aceleração por sistema', () => {
  it('macOS: kern.hv_support=1 → ok; 0 → hvf-off', async () => {
    const mac = resolveSetupPaths({}, '/Users/u', null, 'darwin-arm64');
    const on = await probeDeps(mac, fake({ exec: { 'sysctl -n kern.hv_support': '1\n' } }));
    expect(on.deps.find((d) => d.id === 'kvm')).toMatchObject({ state: 'ok', version: 'Hypervisor.framework' });
    const off = await probeDeps(mac, fake({ exec: { 'sysctl -n kern.hv_support': '0\n' } }));
    expect(off.deps.find((d) => d.id === 'kvm')).toMatchObject({ state: 'user', fix: 'hvf-off' });
  });
  it('Windows: HypervisorPlatform InstallState 1 → ok; outro → whpx-off', async () => {
    const win = resolveSetupPaths({ LOCALAPPDATA: 'C:\\L' }, 'C:\\Users\\u', null, 'win32-x64');
    const cmd = `powershell -NoProfile -Command ${WHPX_QUERY}`;
    const on = await probeDeps(win, fake({ exec: { [cmd]: '1\r\n' } }));
    expect(on.deps.find((d) => d.id === 'kvm')).toMatchObject({ state: 'ok', version: 'WHPX' });
    const off = await probeDeps(win, fake({ exec: { [cmd]: '2\r\n' } }));
    expect(off.deps.find((d) => d.id === 'kvm')).toMatchObject({ state: 'user', fix: 'whpx-off' });
  });
  it('Linux continua com /dev/kvm', async () => {
    const lin = resolveSetupPaths({}, '/home/u', null, 'linux-x64');
    expect((await probeDeps(lin, fake({}))).deps.find((d) => d.id === 'kvm')).toMatchObject({ fix: 'kvm-bios' });
  });
});

describe('tamanhos por sistema', () => {
  it('Windows: sdk e ollama pelo pacote do Windows', async () => {
    const win = resolveSetupPaths({ LOCALAPPDATA: 'C:\\L' }, 'C:\\Users\\u', null, 'win32-x64');
    const r = await probeDeps(win, fake({}));
    expect(r.deps.find((d) => d.id === 'sdk')).toMatchObject({ state: 'todo', sizeMb: 199 });
    expect(r.deps.find((d) => d.id === 'ollama')).toMatchObject({ state: 'todo', sizeMb: 1461 });
  });
});
