/**
 * Trava assíncrona compartilhada entre `ensure()` (via single-flight) e o `applyLocalParallel` (spec paralelismo
 * §Ocioso): enquanto o apply segura a trava trocando o Ollama/LM Studio (segundos a minutos), qualquer `ensure()`
 * espera a vez — os dois mexem no mesmo processo/modelo e nunca podem correr ao mesmo tempo. FIFO: quem chega
 * primeiro roda primeiro; uma falha de uma chamada nunca trava as próximas.
 */
export interface RuntimeLock {
  run<T>(fn: () => Promise<T>): Promise<T>;
}

export function createRuntimeLock(): RuntimeLock {
  let queue: Promise<void> = Promise.resolve();
  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      const result = queue.then(fn, fn);
      // A fila segue mesmo se `fn` rejeitar — só o chamador desta vez vê o erro.
      queue = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}
