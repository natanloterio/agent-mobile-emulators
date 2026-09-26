import type { Dispatch } from 'react';
import type { EnxameBridge } from '../live/types';
import type { FleetAction } from './fleetReducer';
import { bridgeMessage } from './providerActions';

export type ApiBridge = Partial<Pick<EnxameBridge, 'api' | 'resume' | 'kill'>>;
export type Api = EnxameBridge['api'];

export interface ApiDeps {
  readonly dispatch: Dispatch<FleetAction>;
  /** Lido a cada chamada: a bridge pode não existir (Vite no browser). */
  readonly getBridge: () => ApiBridge | undefined;
}

export type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

export const NO_DAEMON = 'daemon não conectado';

const toMessage = (e: unknown) => (e instanceof Error ? bridgeMessage(e) : String(e));

/**
 * Roda uma chamada ao daemon sob `key`: ocupado → ok, ou erro legível no estado.
 * `run` recebe a bridge; sem bridge (ou sem o método) o erro "daemon não conectado" aparece na tela.
 */
export async function track<T>(
  { dispatch, getBridge }: ApiDeps, key: string, run: (b: ApiBridge) => Promise<T> | undefined,
): Promise<Outcome<T>> {
  const bridge = getBridge();
  const p = bridge ? run(bridge) : undefined;
  if (!p) { dispatch({ type: 'requestError', key, message: NO_DAEMON }); return { ok: false }; }
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
