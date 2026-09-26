import type { Dispatch } from 'react';
import { PT, type I18n } from '../i18n/translate';
import type { EnxameBridge } from '../live/types';
import type { FleetAction } from './fleetReducer';
import { bridgeMessage } from './providerActions';

export type ApiBridge = Partial<Pick<EnxameBridge, 'api' | 'resume' | 'kill'>>;
export type Api = EnxameBridge['api'];

export interface ApiDeps {
  readonly dispatch: Dispatch<FleetAction>;
  /** Lido a cada chamada: a bridge pode não existir (Vite no browser). */
  readonly getBridge: () => ApiBridge | undefined;
  /** Idioma das mensagens geradas na UI ("daemon não conectado"); lido a cada chamada. Sem ele: português. */
  readonly getI18n?: () => I18n;
}

export type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

/** Texto em português; na tela sai no idioma de `getI18n` (chave `identities.err.noDaemon`). */
export const NO_DAEMON = PT.t('identities.err.noDaemon');

const toMessage = (e: unknown) => (e instanceof Error ? bridgeMessage(e) : String(e));

/**
 * Roda uma chamada ao daemon sob `key`: ocupado → ok, ou erro legível no estado.
 * `run` recebe a bridge; sem bridge (ou sem o método) o erro "daemon não conectado" aparece na tela.
 */
export async function track<T>(
  { dispatch, getBridge, getI18n }: ApiDeps, key: string, run: (b: ApiBridge) => Promise<T> | undefined,
): Promise<Outcome<T>> {
  const bridge = getBridge();
  const p = bridge ? run(bridge) : undefined;
  if (!p) { dispatch({ type: 'requestError', key, message: (getI18n?.() ?? PT).t('identities.err.noDaemon') }); return { ok: false }; }
  dispatch({ type: 'request', key, phase: 'start' });
  try {
    const value = await p;
    dispatch({ type: 'request', key, phase: 'ok' });
    return { ok: true, value };
  } catch (e) {
    dispatch({ type: 'requestError', key, message: toMessage(e) });
    return { ok: false };
  }
}
