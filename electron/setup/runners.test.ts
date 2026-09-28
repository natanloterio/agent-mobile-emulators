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
  /** HOME simulado (padrão `/home/u`); usado para testar caminhos com espaço no Windows. */
  readonly home?: string;
  /** Variáveis de ambiente simuladas (ex.: `LOCALAPPDATA` no Windows). */
  readonly env?: NodeJS.ProcessEnv;
  /** O que o `readdir` do diretório temporário do JRE (zip com strip) devolve; padrão uma pasta só. */
  readonly readdirJre?: readonly string[];
  /** Ambiente de base do processo (padrão: o do teste). */
  readonly baseEnv?: NodeJS.ProcessEnv;
  /** Erros que o `rename` lança antes de conseguir, um por tentativa. */
  readonly renameFails?: readonly Error[];
}

/** `exists` reflete um conjunto de arquivos que cresce conforme o `run`/`extractZip` falso "instala" cada coisa. */
function deps(platform: PlatformId, o: DepsOpts = {}) {
  const paths = resolveSetupPaths(o.env ?? {}, o.home ?? '/home/u', null, platform);
  const calls: string[] = [];
  const envs: (NodeJS.ProcessEnv | undefined)[] = [];
  const verbatims: (boolean | undefined)[] = [];
  const present = new Set<string>();
  const sleeps: number[] = [];
  const renameErrors = [...(o.renameFails ?? [])];
  if (o.javaHere) present.add(paths.javaBin);
  if (o.sdkmanagerHere) present.add(paths.sdkmanager);
  const d: RunnerDeps = {
    paths,
    download: async (x) => { calls.push(`download ${x.url}`); x.onProgress?.(1_000_000, 2_000_000); },
    run: async (cmd, args, opts) => {
      calls.push(`run ${cmd} ${args.join(' ')}`);
      envs.push(opts?.env);
      verbatims.push(opts?.verbatim);
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
      rename: async (a, b) => {
        calls.push(`mv ${a} ${b}`);
        const err = renameErrors.shift(); if (err) throw err;
        if (b === paths.jreDir) present.add(paths.javaBin);
      },
      chmod: async () => undefined,
      readdir: async (p) => (p.includes('jre') ? (o.readdirJre ?? ['jdk-17.0.20.1+1-jre']) : ['sdkmanager', 'avdmanager']),
    },
    exists: async (p) => present.has(p),
    pull: async (model, bin, progress) => { calls.push(`pull ${model} ${bin}`); progress(10, 20); },
    log: () => undefined,
    sleep: async (ms) => { sleeps.push(ms); },
    ...(o.baseEnv ? { baseEnv: o.baseEnv } : {}),
  };
  return { d, calls, envs, verbatims, sleeps };
}

/** Aspas só quando o argumento tem espaço — mesma regra de `q` em runners.ts. */
const q = (arg: string): string => (arg.includes(' ') ? `"${arg}"` : arg);

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
  it('sdk: com o JRE do Tapflock já extraído, só baixa as cmdline-tools', async () => {
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
  it('sdkmanager.bat roda por cmd /d /s /c com aspas e verbatim; PATH usa ;', async () => {
    const { d, calls, envs, verbatims } = deps('win32-x64', { javaHere: true });
    await createRunners('gpt-oss:20b', 'ollama', d).adb(() => {});
    const args = [`--sdk_root=${d.paths.sdkRoot}`, '--install', 'platform-tools'];
    expect(calls.at(-1)).toBe(`run cmd /d /s /c ""${d.paths.sdkmanager}" ${args.map(q).join(' ')}"`);
    expect(verbatims.at(-1)).toBe(true);
    expect(envs.at(-1)?.PATH?.startsWith(`${d.paths.javaHome}\\bin;`)).toBe(true);
  });
  it('JRE .zip: extrai e move a pasta de dentro para jre/', async () => {
    const { d, calls } = deps('win32-x64');
    await createRunners('gpt-oss:20b', 'ollama', d).sdk(() => {});
    expect(calls.some((c) => c.startsWith(`unzip ${d.paths.downloadsDir}\\jre.zip`))).toBe(true);
    expect(calls.some((c) => c.startsWith('mv ') && c.endsWith(` ${d.paths.jreDir}`))).toBe(true);
  });
  it('JRE .zip com formato inesperado (sem uma pasta única dentro): erro claro', async () => {
    const { d } = deps('win32-x64', { readdirJre: [] });
    await expect(createRunners('gpt-oss:20b', 'ollama', d).sdk(() => {})).rejects.toMatchObject({ kind: 'process', message: expect.stringContaining('formato inesperado') });
  });
  it('ollama: zip com extract-zip, sem tar', async () => {
    const { d, calls } = deps('win32-x64');
    await createRunners('gpt-oss:20b', 'ollama', d).ollama(() => {});
    expect(calls).toContain(`unzip ${d.paths.downloadsDir}\\ollama-windows-amd64.zip ${d.paths.ollamaDir}`);
    expect(calls.some((c) => c.startsWith('run tar'))).toBe(false);
  });
});

describe('Windows: PATH e rename', () => {
  const eperm = () => Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });
  it('JAVA no PATH vai na chave que já existe (Path), sem criar uma segunda PATH', async () => {
    const { d, envs } = deps('win32-x64', { javaHere: true, baseEnv: { Path: 'C:\\Windows', SystemRoot: 'C:\\Windows' } });
    await createRunners('gpt-oss:20b', 'ollama', d).adb(() => {});
    const env = envs.at(-1) ?? {};
    expect(Object.keys(env).filter((k) => /^path$/i.test(k))).toEqual(['Path']);
    expect(env.Path).toBe(`${d.paths.javaHome}\\bin;C:\\Windows`);
    expect(env.JAVA_HOME).toBe(d.paths.javaHome);
  });
  it('sem nenhuma chave de PATH, cria PATH', async () => {
    const { d, envs } = deps('win32-x64', { javaHere: true, baseEnv: { SystemRoot: 'C:\\Windows' } });
    await createRunners('gpt-oss:20b', 'ollama', d).adb(() => {});
    expect(envs.at(-1)?.PATH).toBe(`${d.paths.javaHome}\\bin;`);
  });
  it('rename com EPERM transitório (antivírus) tenta de novo a cada 200 ms', async () => {
    const { d, calls, sleeps } = deps('win32-x64', { renameFails: [eperm()] });
    await createRunners('gpt-oss:20b', 'ollama', d).sdk(() => {});
    expect(calls.filter((c) => c.startsWith('mv ') && c.endsWith(` ${d.paths.jreDir}`))).toHaveLength(2);
    expect(sleeps).toEqual([200]);
  });
  it('rename desiste depois de 5 tentativas; erro que não é transitório não repete', async () => {
    const a = deps('win32-x64', { renameFails: Array.from({ length: 5 }, eperm) });
    await expect(createRunners('gpt-oss:20b', 'ollama', a.d).sdk(() => {})).rejects.toMatchObject({ code: 'EPERM' });
    expect(a.calls.filter((c) => c.startsWith('mv '))).toHaveLength(5);
    const b = deps('win32-x64', { renameFails: [Object.assign(new Error('ENOENT'), { code: 'ENOENT' })] });
    await expect(createRunners('gpt-oss:20b', 'ollama', b.d).sdk(() => {})).rejects.toMatchObject({ code: 'ENOENT' });
    expect(b.calls.filter((c) => c.startsWith('mv '))).toHaveLength(1);
  });
  it('rename das cmdline-tools também repete', async () => {
    const { d, calls } = deps('win32-x64', { javaHere: true, renameFails: [eperm()] });
    await createRunners('gpt-oss:20b', 'ollama', d).sdk(() => {});
    expect(calls.filter((c) => c.startsWith('mv ') && c.endsWith('latest'))).toHaveLength(2);
  });
});

describe('Windows: caminho do SDK com espaço', () => {
  const home = 'C:\\Users\\John Doe';
  const env = { LOCALAPPDATA: `${home}\\AppData\\Local` };

  it('licenças: aspas ao redor do .bat e verbatim: true', async () => {
    const { d, calls, verbatims } = deps('win32-x64', { home, env, javaHere: true, sdkmanagerHere: true });
    expect(d.paths.sdkmanager).toContain(' '); // sanidade: o caminho simulado tem espaço
    await createRunners('gpt-oss:20b', 'ollama', d).sdk(() => {});
    const args = [`--sdk_root=${d.paths.sdkRoot}`, '--licenses'];
    expect(calls.at(-1)).toBe(`run cmd /d /s /c ""${d.paths.sdkmanager}" ${args.map(q).join(' ')}"`);
    expect(verbatims.at(-1)).toBe(true);
  });
  it('instalação (adb): mesma proteção de aspas e verbatim: true', async () => {
    const { d, calls, verbatims } = deps('win32-x64', { home, env });
    await createRunners('gpt-oss:20b', 'ollama', d).adb(() => {});
    const args = [`--sdk_root=${d.paths.sdkRoot}`, '--install', 'platform-tools'];
    expect(calls.at(-1)).toBe(`run cmd /d /s /c ""${d.paths.sdkmanager}" ${args.map(q).join(' ')}"`);
    expect(verbatims.at(-1)).toBe(true);
  });
});

describe('pacote do Ollama sem o binário esperado', () => {
  it('falha com mensagem clara em vez de seguir', async () => {
    const { d } = deps('darwin-arm64', { ollamaBinAppears: false });
    await expect(createRunners('gpt-oss:20b', 'ollama', d).ollama(() => {})).rejects.toMatchObject({ kind: 'process', message: expect.stringContaining('não trouxe') });
  });
  it('mantém o arquivo baixado para a nova tentativa não baixar de novo', async () => {
    const { d, calls } = deps('darwin-arm64', { ollamaBinAppears: false });
    await createRunners('gpt-oss:20b', 'ollama', d).ollama(() => {}).catch(() => undefined);
    const file = `${d.paths.downloadsDir}/${artifactsFor('darwin-arm64').ollama.file}`;
    expect(calls).not.toContain(`rm ${file}`);
  });
});
