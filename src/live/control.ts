import type { TapflockBridge, InputGesture } from './types';

/** Chamadas do modo controle (spec inc. 5 §3.2) pelo canal genérico `window.tapflock.api`. */
export type ApiFn = TapflockBridge['api'];

const path = (id: string, leaf: 'control' | 'input') => `/identities/${encodeURIComponent(id)}/${leaf}`;

/** Liga/desliga o controle humano; com ele ligado o worker da identidade para. */
export async function setControl(api: ApiFn, id: string, on: boolean): Promise<{ id: string; controlled: boolean }> {
  return (await api('POST', path(id, 'control'), { on })) as { id: string; controlled: boolean };
}

/** Um gesto; 409 se o controle não estiver ligado, 400 se o device não sabe executar (ex.: texto não ASCII). */
export async function sendGesture(api: ApiFn, id: string, g: InputGesture): Promise<void> {
  await api('POST', path(id, 'input'), g);
}

/** Mensagem legível de um erro do canal: o main embute `→ <status>: {"error": …}` na mensagem. */
export function apiErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const i = msg.indexOf('{');
  if (i >= 0) {
    try {
      const err = (JSON.parse(msg.slice(i)) as { error?: unknown }).error;
      if (typeof err === 'string') return err;
      if (Array.isArray(err)) return err.map(String).join('; ');
    } catch { /* não era JSON: cai na mensagem crua */ }
  }
  return msg;
}

/**
 * Fila de envio por identidade para o `onInput` do PhoneMock: um gesto só sai depois do anterior terminar
 * (texto e Enter chegam ao device na ordem digitada). Falha vai para `onError` e a fila segue.
 */
export function createGestureSender(api: ApiFn, id: string, onError: (message: string) => void): (g: InputGesture) => Promise<void> {
  let tail: Promise<void> = Promise.resolve();
  return (g) => {
    tail = tail.then(() => sendGesture(api, id, g)).catch((e: unknown) => onError(apiErrorMessage(e)));
    return tail;
  };
}
