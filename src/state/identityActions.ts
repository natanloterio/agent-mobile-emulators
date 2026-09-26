import type { InputGesture } from '../live/types';
import { track, type ApiDeps } from './apiRequest';

export interface IdentityActionDeps extends ApiDeps {
  /** `window.confirm` na tela; injetado para os testes. */
  readonly confirm: (message: string) => boolean;
}

export interface IdentityActions {
  readonly provision: () => Promise<boolean>;
  readonly boot: (id: string, window: boolean) => Promise<boolean>;
  readonly loginDone: (id: string, handle: string) => Promise<boolean>;
  readonly pause: (id: string, paused: boolean) => Promise<boolean>;
  readonly resolve: (id: string) => Promise<boolean>;
  readonly ban: (id: string, name: string, reason: string) => Promise<boolean>;
  readonly discard: (id: string, name: string) => Promise<boolean>;
  readonly restore: (id: string, name: string) => Promise<boolean>;
  readonly rebaseline: (id: string) => Promise<boolean>;
  readonly setControl: (id: string, on: boolean) => Promise<boolean>;
  readonly input: (id: string, gesture: InputGesture) => Promise<boolean>;
}

/** Chave do estado de requisição de uma identidade (erro visível na linha / no device). */
export const idKey = (id: string) => `id:${id}`;
export const inputKey = (id: string) => `input:${id}`;

// Mesmo formato aceito pela lista de permissão do main (electron/api-route.ts).
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const DEFAULT_BAN_REASON = 'marcada como banida pelo operador';

/** Ações das telas Identidades e Device (spec inc. 5 §3.2); puras em relação ao React. */
export function createIdentityActions(deps: IdentityActionDeps): IdentityActions {
  const { dispatch, confirm } = deps;
  const post = (id: string, route: string, body?: unknown, key = idKey(id)): Promise<boolean> => {
    if (!SAFE_ID.test(id)) { dispatch({ type: 'requestError', key, message: `id inválido: ${id}` }); return Promise.resolve(false); }
    return track(deps, key, (b) => b.api?.('POST', `/identities/${id}/${route}`, body)).then((r) => r.ok);
  };
  // Um gesto só sai depois do anterior (spec inc. 5, Frente C): texto e Enter chegam ao device na ordem digitada.
  const inputTails = new Map<string, Promise<boolean>>();
  const queueInput = (id: string, gesture: InputGesture): Promise<boolean> => {
    const next = (inputTails.get(id) ?? Promise.resolve(true)).then(() => post(id, 'input', gesture, inputKey(id)));
    inputTails.set(id, next);
    return next;
  };
  const confirmed = (message: string, then: () => Promise<boolean>) => (confirm(message) ? then() : Promise.resolve(false));

  return {
    provision: () => track(deps, 'provision', (b) => b.api?.('POST', '/identities', {})).then((r) => r.ok),
    boot: (id, window) => post(id, 'boot', { window }),
    loginDone: (id, handle) => {
      const h = handle.trim().replace(/^@*/, '');
      if (!h) { dispatch({ type: 'requestError', key: idKey(id), message: 'informe o @ da conta' }); return Promise.resolve(false); }
      return post(id, 'login-done', { handle: `@${h}` });
    },
    pause: (id, paused) => post(id, 'pause', { paused }),
    resolve: (id) => post(id, 'resolve'),
    ban: (id, name, reason) => {
      const r = reason.trim() || DEFAULT_BAN_REASON;
      return confirmed(`Marcar ${name} como banida?\nMotivo: ${r}\nA identidade sai da frota.`, () => post(id, 'ban', { reason: r }));
    },
    discard: (id, name) => confirmed(`Liberar o disco de ${name}? O AVD é apagado e não volta.`, () => post(id, 'discard')),
    restore: (id, name) => confirmed(`O snapshot de ${name} é antigo (restore-unsafe). Restaurar mesmo assim?`, () => post(id, 'restore', { confirm: true })),
    rebaseline: (id) => post(id, 'rebaseline'),
    setControl: (id, on) => post(id, 'control', { on }),
    input: queueInput,
  };
}
