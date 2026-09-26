import { existsSync, readFileSync } from 'node:fs';

const pidAlive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** bench/run-real disputam device e Ollama com um daemon vivo; leem daemon.json e recusam (spec inc. 3 §4.6). */
export function daemonAlive(infoPath: string, isAlive: (pid: number) => boolean = pidAlive): { pid: number } | null {
  if (!existsSync(infoPath)) return null;
  try {
    const info = JSON.parse(readFileSync(infoPath, 'utf8')) as { pid?: number };
    return typeof info.pid === 'number' && isAlive(info.pid) ? { pid: info.pid } : null;
  } catch { return null; }
}
