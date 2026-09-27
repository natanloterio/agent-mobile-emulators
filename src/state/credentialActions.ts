import { PT, type T } from '../i18n/translate';
import type { EnxameBridge } from '../live/types';
import { track, type TrackDeps } from './apiRequest';
import { bridgeMessage } from './providerActions';

/** Fatia da bridge usada aqui; ausente no browser e em preload antigo. */
export type CredentialBridge = Partial<Pick<EnxameBridge, 'credentials' | 'login'>>;

export interface CredentialActionDeps extends TrackDeps<CredentialBridge> {
  readonly confirm: (message: string) => boolean;
}

export interface CredentialActions {
  /** Status (só usernames) para as linhas; sem cofre na bridge, não faz nada. */
  readonly load: () => Promise<boolean>;
  /** Antes de abrir o formulário: sem chaveiro real, o motivo vira erro da linha. */
  readonly prepare: (id: string) => Promise<boolean>;
  readonly save: (id: string, username: string, password: string) => Promise<boolean>;
  readonly forget: (id: string, name: string) => Promise<boolean>;
  readonly login: (id: string) => Promise<boolean>;
}

export const credKey = (id: string) => `cred:${id}`;
export const loginKey = (id: string) => `login:${id}`;

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Credenciais e login pelo daemon (spec login determinístico). A senha só passa por aqui a caminho da
 * bridge: nunca é despachada ao reducer nem entra em mensagem de erro.
 */
export function createCredentialActions(deps: CredentialActionDeps): CredentialActions {
  const { dispatch, getBridge, confirm } = deps;
  const t: T = (key, params) => (deps.getI18n?.() ?? PT).t(key, params);
  const fail = (key: string, message: string) => { dispatch({ type: 'requestError', key, message }); return Promise.resolve(false); };
  // Sem o cofre na bridge, "daemon não conectado" (mensagem do track) enganaria: é o app que é antigo.
  const vault = () => getBridge()?.credentials;
  const checkId = (id: string) => (SAFE_ID.test(id) ? null : t('identities.err.badId', { id }));

  const load = async (): Promise<boolean> => {
    const c = vault();
    if (!c) return false;
    try {
      dispatch({ type: 'credentialsLoaded', status: await c.status() });
      return true;
    } catch (e) {
      dispatch({ type: 'requestError', key: 'credentials', message: e instanceof Error ? bridgeMessage(e) : String(e) });
      return false;
    }
  };

  // Chamada com erro legível na linha (`key`); sucesso recarrega o status.
  const run = async (key: string, call: (c: NonNullable<CredentialBridge['credentials']>) => Promise<void>) => {
    if (!vault()) return fail(key, t('identities.err.noVault'));
    const r = await track(deps, key, (b) => (b.credentials ? call(b.credentials) : undefined));
    if (r.ok) await load();
    return r.ok;
  };

  return {
    load,
    prepare: async (id) => {
      const c = vault();
      if (!c) return fail(credKey(id), t('identities.err.noVault'));
      try {
        const a = await c.available();
        if (!a.ok) return fail(credKey(id), a.reason ?? t('identities.err.noVault'));
        dispatch({ type: 'request', key: credKey(id), phase: 'ok' });
        return true;
      } catch (e) {
        return fail(credKey(id), e instanceof Error ? bridgeMessage(e) : String(e));
      }
    },
    save: (id, username, password) => {
      const key = credKey(id); const u = username.trim();
      const bad = checkId(id) ?? (!u ? t('identities.err.username') : !password ? t('identities.err.password') : null);
      if (bad) return fail(key, bad);
      return run(key, (c) => c.set(id, u, password));
    },
    forget: async (id, name) => {
      if (!confirm(t('identities.confirm.forgetCredentials', { name }))) return false;
      const ok = await run(credKey(id), (c) => c.clear(id));
      // Resultado antigo de login não vale mais sem as credenciais.
      if (ok) dispatch({ type: 'loginResult', id, result: null });
      return ok;
    },
    login: async (id) => {
      const key = loginKey(id);
      const bad = checkId(id);
      if (bad) return fail(key, bad);
      if (!getBridge()?.login) return fail(key, t('identities.err.noVault'));
      dispatch({ type: 'loginResult', id, result: null });
      const r = await track(deps, key, (b) => b.login?.(id));
      if (r.ok) dispatch({ type: 'loginResult', id, result: r.value });
      return r.ok;
    },
  };
}
