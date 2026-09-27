import { describe, expect, it } from 'vitest';
import { SetupError } from './errors.js';
import { resolveSetupPaths } from './paths.js';
import { CMDLINE_TOOLS, createRunners, JRE, OLLAMA, parseSdkPercent, type RunnerDeps } from './runners.js';

const paths = resolveSetupPaths({}, '/home/u');

function deps(o: { runFails?: (cmd: string, args: readonly string[]) => Error | null; javaHere?: boolean } = {}) {
  const calls: string[] = [];
  const d: RunnerDeps = {
    paths,
    download: async (x) => { calls.push(`download ${x.url}`); x.onProgress?.(1_000_000, 2_000_000); },
    run: async (cmd, args, opts) => {
      calls.push(`run ${cmd.replace(paths.sdkRoot, '$SDK')} ${args.join(' ').replaceAll(paths.sdkRoot, '$SDK')}`);
      opts?.onLine?.('[=====     ] 50% Downloading');
      const err = o.runFails?.(cmd, args); if (err) throw err;
    },
    extractZip: async (zip, dir) => { calls.push(`unzip ${zip} ${dir}`); },
    fs: {
      rm: async (p) => { calls.push(`rm ${p}`); },
      mkdir: async () => undefined,
      rename: async (a, b) => { calls.push(`mv ${a} ${b}`); },
      chmod: async () => undefined,
      readdir: async () => ['sdkmanager', 'avdmanager'],
    },
    exists: async (p) => (o.javaHere ?? true) && p.endsWith('/jre/bin/java'),
    pull: async (model, bin, progress) => { calls.push(`pull ${model} ${bin}`); progress(10, 20); },
    log: () => undefined,
  };
  return { d, calls };
}

describe('parseSdkPercent', () => {
  it('lê a porcentagem da barra do sdkmanager', () => {
    expect(parseSdkPercent('[=======                                ] 20% Downloading x86_64-34_r14.zip')).toBe(20);
    expect(parseSdkPercent('[=======================================] 100% Unzipping...')).toBe(100);
    expect(parseSdkPercent('Loading package information...')).toBeNull();
  });
});

describe('createRunners', () => {
  it('sdk: baixa JRE e cmdline-tools, extrai, move para cmdline-tools/latest e aceita licenças', async () => {
    const { d, calls } = deps();
    const seen: [number, number][] = [];
    await createRunners('gpt-oss:20b', 'ollama', d).sdk((a, b) => seen.push([a, b]));
    expect(calls).toContain(`download ${JRE.url}`);
    expect(calls).toContain(`download ${CMDLINE_TOOLS.url}`);
    expect(calls.some((c) => c.startsWith('run tar -xzf'))).toBe(true);
    expect(calls).toContain(`mv ${paths.downloadsDir}/cmdline-tools-unzip/cmdline-tools ${paths.sdkRoot}/cmdline-tools/latest`);
    expect(calls).toContain('run $SDK/cmdline-tools/latest/bin/sdkmanager --sdk_root=$SDK --licenses');
    expect(seen.at(-1)).toEqual([JRE.sizeMb + CMDLINE_TOOLS.sizeMb, JRE.sizeMb + CMDLINE_TOOLS.sizeMb]);
  });
  it('img: sdkmanager --install da imagem, progresso pela barra', async () => {
    const { d, calls } = deps();
    const seen: [number, number][] = [];
    await createRunners('gpt-oss:20b', 'ollama', d).img((a, b) => seen.push([a, b]));
    expect(calls).toContain('run $SDK/cmdline-tools/latest/bin/sdkmanager --sdk_root=$SDK --install system-images;android-34;google_apis_playstore;x86_64');
    expect(seen).toContainEqual([800, 1600]);
    expect(seen.at(-1)).toEqual([1600, 1600]);
  });
  it('ollama: baixa o .tar.zst fixado, extrai com --zstd e apaga o arquivo', async () => {
    const { d, calls } = deps();
    await createRunners('gpt-oss:20b', 'ollama', d).ollama(() => {});
    expect(calls).toContain(`download ${OLLAMA.url}`);
    expect(calls).toContain(`run tar --zstd -xf ${paths.downloadsDir}/ollama-linux-amd64.tar.zst -C ${paths.ollamaDir}`);
    expect(calls).toContain(`rm ${paths.downloadsDir}/ollama-linux-amd64.tar.zst`);
  });
  it('ollama: tar sem zstd vira mensagem com o apt install', async () => {
    const { d } = deps({ runFails: (cmd) => (cmd === 'tar' ? new Error('tar saiu com código 2: tar (child): zstd: Cannot exec: No such file or directory') : null) });
    await expect(createRunners('gpt-oss:20b', 'ollama', d).ollama(() => {})).rejects.toSatisfy((e: SetupError) => e.kind === 'process' && e.message.includes('sudo apt install zstd'));
  });
  it('model: puxa o modelo escolhido com o binário informado', async () => {
    const { d, calls } = deps();
    await createRunners('qwen3:14b', '/opt/ollama', d).model(() => {});
    expect(calls).toContain('pull qwen3:14b /opt/ollama');
  });
});
