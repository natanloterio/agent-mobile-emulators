import { describe, expect, it } from 'vitest';
import { DaemonStartError, EXIT_ALREADY_RUNNING, failedStatus, waitForDaemon } from './daemon-wait';

const info = { port: 1, token: 't', pid: 42 };
function clock() { let t = 0; return { now: () => t, sleep: async (ms: number) => { t += ms; } }; }

describe('waitForDaemon', () => {
  it('devolve o daemon.json assim que o processo dele está vivo', async () => {
    let reads = 0;
    const r = await waitForDaemon({ ...clock(), read: () => (++reads > 2 ? info : null), alive: () => true, exitCode: () => undefined, timeoutMs: 15_000 });
    expect(r).toEqual(info);
  });
  it('o daemon morreu na subida (ex.: porta ocupada): falha na hora, com o código de saída, sem esperar os 15 s', async () => {
    const c = clock();
    const err = await waitForDaemon({ ...c, read: () => null, alive: () => false, exitCode: () => (c.now() >= 500 ? 1 : undefined), timeoutMs: 15_000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DaemonStartError);
    expect((err as DaemonStartError).failure).toEqual({ reason: 'exited', exitCode: 1 });
    expect(c.now()).toBeLessThan(1000);
  });
  it('nada em 15 s: falha por tempo', async () => {
    const err = await waitForDaemon({ ...clock(), read: () => null, alive: () => false, exitCode: () => undefined, timeoutMs: 15_000 }).catch((e: unknown) => e);
    expect((err as DaemonStartError).failure).toEqual({ reason: 'timeout', exitCode: null });
  });
  it('saída 3 = outro daemon já é dono da pasta: segue esperando o daemon.json dele em vez de falhar', async () => {
    let reads = 0;
    const r = await waitForDaemon({ ...clock(), read: () => (++reads > 4 ? info : null), alive: () => true, exitCode: () => EXIT_ALREADY_RUNNING, timeoutMs: 15_000 });
    expect(r).toEqual(info);
  });
  it('spawn que falhou (binário ausente) aparece com o erro real, sem esperar o prazo', async () => {
    const c = clock();
    const err = await waitForDaemon({ ...c, read: () => null, alive: () => false, exitCode: () => undefined, spawnError: () => new Error('spawn ENOENT'), timeoutMs: 15_000 }).catch((e: unknown) => e);
    expect((err as Error).message).toBe('spawn ENOENT');
    expect(c.now()).toBe(0);
  });
  it('daemon.json velho (pid morto) não conta como pronto', async () => {
    const err = await waitForDaemon({ ...clock(), read: () => info, alive: () => false, exitCode: () => undefined, timeoutMs: 1000 }).catch((e: unknown) => e);
    expect((err as DaemonStartError).failure.reason).toBe('timeout');
  });
});

describe('failedStatus', () => {
  it('motivo vira dado para a tela; erro qualquer vira "other" com o texto como detalhe', () => {
    expect(failedStatus(new DaemonStartError({ reason: 'exited', exitCode: 1 }), '/d/daemon.log'))
      .toMatchObject({ state: 'failed', reason: 'exited', exitCode: 1, logPath: '/d/daemon.log' });
    expect(failedStatus(new Error('spawn ENOENT'), null)).toEqual({ state: 'failed', reason: 'other', exitCode: null, logPath: null, detail: 'spawn ENOENT' });
  });
});
