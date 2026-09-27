import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { toSetupError } from './errors.js';

export type SpawnFn = (cmd: string, args: readonly string[], opts: { env: NodeJS.ProcessEnv }) => ChildProcess;
export interface ProcOpts {
  readonly env?: NodeJS.ProcessEnv;
  /** Escrito no stdin e fechado (ex.: `y` para as licenças do sdkmanager). */
  readonly stdin?: string;
  readonly onLine?: (line: string) => void;
}

const defaultSpawn: SpawnFn = (cmd, args, opts) => spawn(cmd, [...args], { env: opts.env, stdio: ['pipe', 'pipe', 'pipe'] });

/** Roda até o fim; cada linha (separada por \r ou \n) vai para `onLine`. Código ≠ 0 rejeita com as últimas 5 linhas. */
export function runProcess(cmd: string, args: readonly string[], o: ProcOpts = {}, spawnFn: SpawnFn = defaultSpawn): Promise<void> {
  return new Promise((resolve, reject) => {
    let tail: readonly string[] = [];
    let child: ChildProcess;
    try { child = spawnFn(cmd, args, { env: o.env ?? process.env }); } catch (e) { reject(toSetupError(e)); return; }
    const onChunk = (buf: Buffer | string) => {
      for (const raw of String(buf).split(/[\r\n]+/)) {
        const line = raw.trim();
        if (!line) continue;
        tail = [...tail, line].slice(-5);
        o.onLine?.(line);
      }
    };
    child.stdout?.on('data', onChunk);
    child.stderr?.on('data', onChunk);
    child.on('error', (e) => reject(toSetupError(e)));
    child.on('close', (code: number | null) => {
      if (code === 0) resolve();
      else reject(toSetupError(new Error(`${path.basename(cmd)} saiu com código ${code}: ${tail.join(' | ')}`)));
    });
    child.stdin?.on('error', () => undefined); // processo que sai antes de ler o stdin (EPIPE)
    if (o.stdin) child.stdin?.write(o.stdin);
    child.stdin?.end();
  });
}
