import { PT, type T } from '../i18n/translate';
import type { InputGesture } from '../live/types';
import { track, type ApiDeps } from './apiRequest';

export interface IdentityActionDeps extends ApiDeps {
  /** `window.confirm` na tela; injetado para os testes. */
  readonly confirm: (message: string) => boolean;
}

export interface IdentityActions {
  readonly provision: (pin?: string) => Promise<boolean>;
  readonly registerPin: (id: string, pin: string) => Promise<boolean>;
  readonly boot: (id: string, window: boolean) => Promise<boolean>;
  readonly loginDone: (id: string, handle: string) => Promise<boolean>;
  readonly pause: (id: string, paused: boolean) => Promise<boolean>;
  readonly resolve: (id: string) => Promise<boolean>;
  readonly ban: (id: string, name: string, reason: string) => Promise<boolean>;
  readonly discard: (id: string, name: string) => Promise<boolean>;
  readonly restore: (id: string, name: string) => Promise<boolean>;
  readonly rebaseline: (id: string) => Promise<boolean>;
  readonly acceptVersion: (id: string) => Promise<boolean>;
  readonly shutdown: (id: string) => Promise<boolean>;
  readonly setControl: (id: string, on: boolean) => Promise<boolean>;
  readonly input: (id: string, gesture: InputGesture) => Promise<boolean>;
}

/** Chave do estado de requisição de uma identidade (erro visível na linha / no device). */
export const idKey = (id: string) => `id:${id}`;
export const inputKey = (id: string) => `input:${id}`;

// Mesmo formato aceito pela lista de permissão do main (electron/api-route.ts).
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const PIN = /^\d{4,16}$/;

/** Ações das telas Identidades e Device (spec inc. 5 §3.2); puras em relação ao React. */
export function createIdentityActions(deps: IdentityActionDeps): IdentityActions {
  const { dispatch, confirm } = deps;
  // Idioma lido a cada ação: trocar o seletor vale para a próxima mensagem sem recriar as ações.
  const t: T = (key, params) => (deps.getI18n?.() ?? PT).t(key, params);
  const post = (id: string, route: string, body?: unknown, key = idKey(id)): Promise<boolean> => {
    if (!SAFE_ID.test(id)) { dispatch({ type: 'requestError', key, message: t('identities.err.badId', { id }) }); return Promise.resolve(false); }
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
    provision: (pin) => {
      const p = pin?.trim() ?? '';
      if (p && !PIN.test(p)) { dispatch({ type: 'requestError', key: 'provision', message: t('identities.err.pin') }); return Promise.resolve(false); }
      return track(deps, 'provision', (b) => b.api?.('POST', '/identities', p ? { pin: p } : {})).then((r) => r.ok);
    },
    registerPin: (id, pin) => {
      const p = pin.trim();
      if (!PIN.test(p)) { dispatch({ type: 'requestError', key: idKey(id), message: t('identities.err.pin') }); return Promise.resolve(false); }
      return post(id, 'pin', { pin: p });
    },
    boot: (id, window) => post(id, 'boot', { window }),
    loginDone: (id, handle) => {
      const h = handle.trim().replace(/^@*/, '');
      if (!h) { dispatch({ type: 'requestError', key: idKey(id), message: t('identities.err.handle') }); return Promise.resolve(false); }
      return post(id, 'login-done', { handle: `@${h}` });
    },
    pause: (id, paused) => post(id, 'pause', { paused }),
    resolve: (id) => post(id, 'resolve'),
    ban: (id, name, reason) => {
      const r = reason.trim() || t('identities.ban.defaultReason');
      return confirmed(t('identities.confirm.ban', { name, reason: r }), () => post(id, 'ban', { reason: r }));
    },
    discard: (id, name) => confirmed(t('identities.confirm.discard', { name }), () => post(id, 'discard')),
    restore: (id, name) => confirmed(t('identities.confirm.restore', { name }), () => post(id, 'restore', { confirm: true })),
    rebaseline: (id) => post(id, 'rebaseline'),
    acceptVersion: (id) => post(id, 'accept-version'),
    shutdown: (id) => post(id, 'shutdown'),
    setControl: (id, on) => post(id, 'control', { on }),
    input: queueInput,
  };
}
