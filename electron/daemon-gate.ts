/**
 * Canais IPC existem desde a subida do app; antes de o daemon responder eles falham com mensagem legível
 * (antes: "No handler registered for 'enxame:…'", porque o registro só acontecia depois do daemon).
 */
export interface DaemonGate<I> {
  set(info: I): void;
  fail(message: string): void;
  use<T>(fn: (info: I) => Promise<T>): Promise<T>;
}

export function createDaemonGate<I>(): DaemonGate<I> {
  let info: I | null = null; let error: string | null = null;
  return {
    set: (i) => { info = i; error = null; },
    fail: (m) => { error = m; },
    use: (fn) => (info !== null ? fn(info)
      : Promise.reject(new Error(error ? `daemon não conectado: ${error}` : 'daemon não conectado ainda; tente de novo em instantes'))),
  };
}
