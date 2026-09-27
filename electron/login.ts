import { assertId, type Credential } from './credentials.js';

export type LoginOutcome = 'logged-in' | 'already-logged-in' | 'needs-human';
export interface LoginResult { readonly outcome: LoginOutcome; readonly detail: string }

export interface LoginDeps {
  /** Credencial decifrada do cofre. */
  readonly get: (id: string) => Promise<Credential | null>;
  /** POST ao daemon (já passando pelo gate). */
  readonly post: (path: string, body: unknown) => Promise<unknown>;
}

const OUTCOMES: readonly string[] = ['logged-in', 'already-logged-in', 'needs-human'];

const isResult = (v: unknown): v is LoginResult =>
  typeof v === 'object' && v !== null && OUTCOMES.includes((v as LoginResult).outcome) && typeof (v as LoginResult).detail === 'string';

/**
 * `enxame:login`: só o main chama `POST /identities/:id/login` (a rota não está na lista do canal genérico),
 * com a senha que ele mesmo decifrou. O id é validado antes de virar caminho.
 */
export async function loginViaDaemon(id: string, { get, post }: LoginDeps): Promise<LoginResult> {
  assertId(id);
  const cred = await get(id);
  if (!cred) throw new Error(`sem credenciais salvas para ${id}`);
  const r = await post(`/identities/${id}/login`, { username: cred.username, password: cred.password });
  if (!isResult(r)) throw new Error('resposta inesperada do daemon ao login');
  return { outcome: r.outcome, detail: r.detail };
}
