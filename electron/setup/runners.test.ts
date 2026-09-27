import { describe, expect, it } from 'vitest';
import { artifactsFor } from './artifacts.js';
import { SetupError } from './errors.js';
import { resolveSetupPaths } from './paths.js';
import type { PlatformId } from './platform.js';
import { createRunners, parseSdkPercent, type RunnerDeps } from './runners.js';

interface DepsOpts {
  readonly runFails?: (cmd: string, args: readonly string[]) => Error | null;
  readonly javaHere?: boolean;
  readonly sdkmanagerHere?: boolean;
  /** padrão `true`: o `run`/`extractZip` do Ollama acrescenta `paths.ollamaBin` ao conjunto de arquivos existentes. */
  readonly ollamaBinAppears?: boolean;
}

/** `exists` reflete um conjunto de arquivos que cresce conforme o `run`/`extractZip` falso "instala" cada coisa. */
function deps(platform: PlatformId, o: DepsOpts = {}) {
  const paths = resolveSetupPaths({}, '/home/u', null, platform);
  const calls: string[] = [];
  const envs: (NodeJS.ProcessEnv | undefined)[] = [];
  const present = new Set<string>();
  if (o.javaHere) present.add(paths.javaBin);
  if (o.sdkmanagerHere) present.add(paths.sdkmanager);
  const d: RunnerDeps = {
    paths,
    download: async (x) => { calls.push(`download ${x.url}`); x.onProgress?.(1_000_000, 2_000_000); },
    run: async (cmd, args, opts) => {
      calls.push(`run ${cmd} ${args.join(' ')}`);
      envs.push(opts?.env);
      opts?.onLine?.('[=====     ] 50% Downloading');
      if (cmd === 'tar') {
        if (args.includes(paths.jreDir)) present.add(paths.javaBin);
        if ((o.ollamaBinAppears ?? true) && args.includes(paths.ollamaDir)) present.add(paths.ollamaBin);
      }
      const err = o.runFails?.(cmd, args); if (err) throw err;
    },
    extractZip: async (zip, dir) => {
      calls.push(`unzip ${zip} ${dir}`);
      if ((o.ollamaBinAppears ?? true) && dir === paths.ollamaDir) present.add(paths.ollamaBin);
    },
    fs: {
      rm: async (p) => { calls.push(`rm ${p}`); },
      mkdir: async () => undefined,
      rename: async (a, b) => { calls.push(`mv ${a} ${b}`); if (b === paths.jreDir) present.add(paths.javaBin); },
      chmod: async () => undefined,
      readdir: async (p) => (p.includes('jre') ? ['jdk-17.0.20.1+1-jre'] : ['sdkmanager', 'avdmanager']),
    },
    exists: async (p) => present.has(p),
    pull: async (model, bin, progress) => { calls.push(`pull ${model} ${bin}`); progress(10, 20); },
    log: () => undefined,
  };
  return { d, calls, envs };
}

describe('parseSdkPercent', () => {
  it('lê a porcentagem da barra do sdkmanager', () => {
    expect(parseSdkPercent('[=======                                ] 20% Downloading x86_64-34_r14.zip')).toBe(20);
    expect(parseSdkPercent('[=======================================] 100% Unzipping...')).toBe(100);
    expect(parseSdkPercent('Loading package information...')).toBeNull();
  });
});

describe('Linux (comportamento de hoje)', () => {
  it('sdk: baixa JRE e cmdline-tools, extrai, move para cmdline-tools/latest e aceita licenças', async () => {
    const { d, calls } = deps('linux-x64', { javaHere: false });
    const a = artifactsFor('linux-x64');
    const seen: [number, number][] = [];
    await createRunners('gpt-oss:20b', 'ollama', d).sdk((x, y) => seen.push([x, y]));
    expect(calls).toContain(`download ${a.jre.url}`);
    expect(calls).toContain(`download ${a.cmdlineTools.url}`);
    expect(calls.some((c) => c.startsWith('run tar -xzf'))).toBe(true);
    expect(calls).toContain(`mv ${d.paths.downloadsDir}/cmdline-tools-unzip/cmdline-tools ${d.paths.sdkRoot}/cmdline-tools/latest`);
    expect(calls).toContain(`run ${d.paths.sdkmanager} --sdk_root=${d.paths.sdkRoot} --licenses`);
    expect(seen.at(-1)).toEqual([a.jre.sizeMb + a.cmdlineTools.sizeMb, a.jre.sizeMb + a.cmdlineTools.sizeMb]);
  });
  it('sdk: com o JRE do Enxame já extraído, só baixa as cmdline-tools', async () => {
    const { d, calls } = deps('linux-x64', { javaHere: true });
    const a = artifactsFor('linux-x64');
    await createRunners('gpt-oss:20b', 'ollama', d).sdk(() => {});
    expect(calls).not.toContain(`download ${a.jre.url}`);
    expect(calls.some((c) => c.startsWith('run tar -xzf'))).toBe(false);
    expect(calls).toContain(`download ${a.cmdlineTools.url}`);
  });
  it('sdk: sdkmanager já presente (repetir depois de falha), só instala o JRE e aceita licenças', async () => {
    const { d, calls } = deps('linux-x64', { javaHere: false, sdkmanagerHere: true });
    const a = artifactsFor('linux-x64');
    await createRunners('gpt-oss:20b', 'ollama', d).sdk(() => {});
    expect(calls).toContain(`download ${a.jre.url}`);
    expect(calls).not.toContain(`download ${a.cmdlineTools.url}`);
    expect(calls.some((c) => c.startsWith('unzip'))).toBe(false);
    expect(calls).toContain(`run ${d.paths.sdkmanager} --sdk_root=${d.paths.sdkRoot} --licenses`);
  });
  it('img: sdkmanager --install da imagem, progresso pela barra', async () => {
    const { d, calls } = deps('linux-x64');
    const seen: [number, number][] = [];
    await createRunners('gpt-oss:20b', 'ollama', d).img((x, y) => seen.push([x, y]));
    expect(calls).toContain(`run ${d.paths.sdkmanager} --sdk_root=${d.paths.sdkRoot} --install system-images;android-34;google_apis_playstore;x86_64`);
    expect(seen).toContainEqual([800, 1600]);
    expect(seen.at(-1)).toEqual([1600, 1600]);
  });
  it('ollama: baixa o .tar.zst fixado, extrai com --zstd e apaga o arquivo', async () => {
    const { d, calls } = deps('linux-x64');
    const a = artifactsFor('linux-x64');
    await createRunners('gpt-oss:20b', 'ollama', d).ollama(() => {});
    expect(calls).toContain(`download ${a.ollama.url}`);
    expect(calls).toContain(`run tar --zstd -xf ${d.paths.downloadsDir}/${a.ollama.file} -C ${d.paths.ollamaDir}`);
    expect(calls).toContain(`rm ${d.paths.downloadsDir}/${a.ollama.file}`);
  });
  it('ollama: tar sem zstd vira mensagem com o apt install', async () => {
    const { d } = deps('linux-x64', { runFails: (cmd) => (cmd === 'tar' ? new Error('tar saiu com código 2: tar (child): zstd: Cannot exec: No such file or directory') : null) });
    await expect(createRunners('gpt-oss:20b', 'ollama', d).ollama(() => {})).rejects.toSatisfy((e: SetupError) => e.kind === 'process' && e.message.includes('sudo apt install zstd'));
  });
  it('model: puxa o modelo escolhido com o binário informado', async () => {
    const { d, calls } = deps('linux-x64');
    await createRunners('qwen3:14b', '/opt/ollama', d).model(() => {});
    expect(calls).toContain('pull qwen3:14b /opt/ollama');
  });
});

describe('macOS Apple Silicon', () => {
  it('JRE .tar.gz extraído com strip 1 e JAVA_HOME em Contents/Home', async () => {
    const { d, calls, envs } = deps('darwin-arm64');
    await createRunners('gpt-oss:20b', 'ollama', d).sdk(() => {});
    expect(calls).toContain(`run tar -xzf ${d.paths.downloadsDir}/jre.tar.gz -C ${d.paths.jreDir} --strip-components=1`);
    expect(envs.at(-1)?.JAVA_HOME).toBe(d.paths.javaHome);
  });
  it('img instala a imagem arm64-v8a', async () => {
    const { d, calls } = deps('darwin-arm64');
    await createRunners('gpt-oss:20b', 'ollama', d).img(() => {});
    expect(calls.some((c) => c.endsWith('--install system-images;android-34;google_apis_playstore;arm64-v8a'))).toBe(true);
  });
  it('ollama: tgz com tar -xzf e binário na raiz', async () => {
    const { d, calls } = deps('darwin-arm64');
    await createRunners('gpt-oss:20b', 'ollama', d).ollama(() => {});
    expect(calls).toContain(`run tar -xzf ${d.paths.downloadsDir}/ollama-darwin.tgz -C ${d.paths.ollamaDir}`);
  });
});

describe('Windows', () => {
  it('sdkmanager.bat roda por cmd /c e PATH usa ;', async () => {
    const { d, calls, envs } = deps('win32-x64', { javaHere: true });
    await createRunners('gpt-oss:20b', 'ollama', d).adb(() => {});
    expect(calls.at(-1)).toBe(`run cmd /c ${d.paths.sdkmanager} --sdk_root=${d.paths.sdkRoot} --install platform-tools`);
    expect(envs.at(-1)?.PATH?.startsWith(`${d.paths.javaHome}\\bin;`)).toBe(true);
  });
  it('JRE .zip: extrai e move a pasta de dentro para jre/', async () => {
    const { d, calls } = deps('win32-x64');
    await createRunners('gpt-oss:20b', 'ollama', d).sdk(() => {});
    expect(calls.some((c) => c.startsWith(`unzip ${d.paths.downloadsDir}\\jre.zip`))).toBe(true);
    expect(calls.some((c) => c.startsWith('mv ') && c.endsWith(` ${d.paths.jreDir}`))).toBe(true);
  });
  it('ollama: zip com extract-zip, sem tar', async () => {
    const { d, calls } = deps('win32-x64');
    await createRunners('gpt-oss:20b', 'ollama', d).ollama(() => {});
    expect(calls).toContain(`unzip ${d.paths.downloadsDir}\\ollama-windows-amd64.zip ${d.paths.ollamaDir}`);
    expect(calls.some((c) => c.startsWith('run tar'))).toBe(false);
  });
});

describe('pacote do Ollama sem o binário esperado', () => {
  it('falha com mensagem clara em vez de seguir', async () => {
    const { d } = deps('darwin-arm64', { ollamaBinAppears: false });
    await expect(createRunners('gpt-oss:20b', 'ollama', d).ollama(() => {})).rejects.toMatchObject({ kind: 'process', message: expect.stringContaining('não trouxe') });
  });
});
