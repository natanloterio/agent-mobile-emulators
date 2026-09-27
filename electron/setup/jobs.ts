import { toSetupError } from './errors.js';
import type { JobRunners } from './runners.js';
import { JOB_ORDER, type JobEvent, type JobId } from './types.js';

const THROTTLE_MS = 200;

/**
 * Roda os itens pedidos na ordem fixa, um por vez. Emite `wait` para todos, depois `run` (com no máximo um evento de
 * progresso a cada 200 ms, para não inundar o IPC), `done` ou `err`. Um erro para a fila; o retry manda de novo só o
 * que não terminou e os downloads continuam do `.part`.
 */
export async function runJobs(jobs: readonly JobId[], runners: JobRunners, emit: (e: JobEvent) => void, now: () => number = Date.now): Promise<void> {
  const queue = JOB_ORDER.filter((id) => jobs.includes(id));
  for (const id of queue) emit({ id, state: 'wait', doneMb: 0, totalMb: 0, error: null });
  for (const id of queue) {
    let last = { doneMb: 0, totalMb: 0 };
    let lastEmit = -Infinity;
    emit({ id, state: 'run', ...last, error: null });
    try {
      await runners[id]((doneMb, totalMb) => {
        last = { doneMb, totalMb };
        const t = now();
        if (t - lastEmit < THROTTLE_MS && doneMb < totalMb) return;
        lastEmit = t;
        emit({ id, state: 'run', doneMb, totalMb, error: null });
      });
      emit({ id, state: 'done', doneMb: last.totalMb || last.doneMb, totalMb: last.totalMb, error: null });
    } catch (e) {
      const err = toSetupError(e);
      emit({ id, state: 'err', ...last, error: { kind: err.kind, message: err.message } });
      return;
    }
  }
}
