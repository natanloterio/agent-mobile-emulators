import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';

const pidAlive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** bench/run-real disputam device e Ollama com um daemon vivo; leem daemon.json e recusam (spec inc. 3 §4.6). */
export function daemonAlive(infoPath: string, isAlive: (pid: number) => boolean = pidAlive): { pid: number } | null {
  if (!existsSync(infoPath)) return null;
  try {
    const info = JSON.parse(readFileSync(infoPath, 'utf8')) as { pid?: number };
    return typeof info.pid === 'number' && isAlive(info.pid) ? { pid: info.pid } : null;
  } catch { return null; }
}

export type InstanceLock = { readonly ok: true; readonly release: () => void } | { readonly ok: false; readonly pid: number };

/**
 * Um daemon por pasta de dados (mesmo banco, mesmos emuladores). Antes a porta fixa fazia esse papel por acaso; com a
 * porta de reserva (server/listen.ts) um segundo daemon subiria ao lado do primeiro. Criação exclusiva do arquivo;
 * trava de um pid morto (queda) é retomada.
 */
export function acquireInstanceLock(file: string, pid: number = process.pid, isAlive: (pid: number) => boolean = pidAlive): InstanceLock {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(file, String(pid), { flag: 'wx' });
      return { ok: true, release: () => { try { if (readFileSync(file, 'utf8') === String(pid)) unlinkSync(file); } catch { /* já foi */ } } };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const owner = Number(readFileSync(file, 'utf8').trim());
      if (Number.isInteger(owner) && owner > 0 && owner !== pid && isAlive(owner)) return { ok: false, pid: owner };
      unlinkSync(file);
    }
  }
  throw new Error(`não deu para criar a trava ${file}`);
}
