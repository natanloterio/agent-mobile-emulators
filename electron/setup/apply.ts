import type { SetupMode } from './types.js';

export type Role = 'lider' | 'worker' | 'esc';
export interface ProviderPatchBody { readonly mode: 'nuvem' | 'local'; readonly model: string; readonly endpoint?: string; readonly runtime?: 'ollama' }

/** Iguais a CLOUD_MODEL e LOCAL_ENDPOINT_DEFAULT em daemon/src/provider/config.ts. */
const CLOUD: Readonly<Record<Role, string>> = { lider: 'claude-sonnet-5', worker: 'claude-haiku-4-5', esc: 'claude-haiku-4-5' };
const LOCAL_ENDPOINT = 'http://127.0.0.1:11434/v1';
const WHERE: Readonly<Record<SetupMode, Readonly<Record<Role, 'cloud' | 'local'>>>> = {
  misto: { lider: 'cloud', worker: 'local', esc: 'cloud' },
  local: { lider: 'local', worker: 'local', esc: 'local' },
  nuvem: { lider: 'cloud', worker: 'cloud', esc: 'cloud' },
};

/** Corpo do `PUT /providers/:role` de cada papel para o modo escolhido no onboarding. */
export function providerPatches(mode: SetupMode, localModel: string): Readonly<Record<Role, ProviderPatchBody>> {
  const patch = (r: Role): ProviderPatchBody => (WHERE[mode][r] === 'cloud'
    ? { mode: 'nuvem', model: CLOUD[r] }
    : { mode: 'local', model: localModel, endpoint: LOCAL_ENDPOINT, runtime: 'ollama' });
  return { lider: patch('lider'), worker: patch('worker'), esc: patch('esc') };
}
