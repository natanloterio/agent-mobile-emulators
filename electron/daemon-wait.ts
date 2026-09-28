export interface DaemonFailure { readonly reason: 'exited' | 'timeout'; readonly exitCode: number | null }

/** Falha na subida do daemon, com o motivo em forma de dado para a tela traduzir (o texto aqui é só para o log). */
export class DaemonStartError extends Error {
  constructor(readonly failure: DaemonFailure) {
    super(failure.reason === 'exited' ? `o daemon encerrou na subida (código ${failure.exitCode ?? '?'})` : 'o daemon não respondeu a tempo');
  }
}

/** Saída do daemon que achou outro já rodando na mesma pasta de dados (daemon/src/index.ts, trava de instância). */
export const EXIT_ALREADY_RUNNING = 3;

export interface WaitDeps<I extends { pid: number }> {
  readonly read: () => I | null;
  readonly alive: (pid: number) => boolean;
  /** Código de saída do processo que acabamos de subir; `undefined` enquanto ele roda (ou se não subimos nenhum). */
  readonly exitCode: () => number | null | undefined;
  /** Erro do próprio spawn (binário ausente, sem permissão): nesse caso o Node não emite 'exit'. */
  readonly spawnError?: () => Error | undefined;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
  readonly timeoutMs: number;
}

const POLL_MS = 250;

/** Espera o daemon.json de um daemon vivo; se o processo que subimos morre antes, falha na hora em vez de esperar o prazo. */
export async function waitForDaemon<I extends { pid: number }>(d: WaitDeps<I>): Promise<I> {
  const t0 = d.now();
  while (d.now() - t0 < d.timeoutMs) {
    const info = d.read();
    if (info && d.alive(info.pid)) return info;
    const spawnError = d.spawnError?.();
    if (spawnError) throw spawnError;
    const code = d.exitCode();
    if (code !== undefined && code !== EXIT_ALREADY_RUNNING) throw new DaemonStartError({ reason: 'exited', exitCode: code });
    await d.sleep(POLL_MS);
  }
  throw new DaemonStartError({ reason: 'timeout', exitCode: null });
}

/** O que a tela sabe do daemon: subindo, pronto, ou falhou (com motivo e onde está o log). */
export type DaemonStatus =
  | { readonly state: 'starting' | 'ok' }
  | { readonly state: 'failed'; readonly reason: DaemonFailure['reason'] | 'other'; readonly exitCode: number | null; readonly logPath: string | null; readonly detail: string };

export function failedStatus(e: unknown, logPath: string | null): DaemonStatus {
  const detail = String((e as Error)?.message ?? e).slice(0, 300);
  if (e instanceof DaemonStartError) return { state: 'failed', ...e.failure, logPath, detail };
  return { state: 'failed', reason: 'other', exitCode: null, logPath, detail };
}
