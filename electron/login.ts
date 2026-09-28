import { assertId } from './credentials.js';

export type LoginOutcome = 'logged-in' | 'already-logged-in' | 'needs-human';
export interface LoginResult { readonly outcome: LoginOutcome; readonly detail: string }

const OUTCOMES: readonly string[] = ['logged-in', 'already-logged-in', 'needs-human'];
const isResult = (v: unknown): v is LoginResult =>
  typeof v === 'object' && v !== null && OUTCOMES.includes((v as LoginResult).outcome) && typeof (v as LoginResult).detail === 'string';

/**
 * `tapflock:login`: o daemon usa a credencial do próprio cofre (spec missões §Cofre); a senha não passa mais pelo main.
 * O id é validado antes de virar caminho.
 */
export async function loginViaDaemon(id: string, { post }: { readonly post: (path: string, body: unknown) => Promise<unknown> }): Promise<LoginResult> {
  assertId(id);
  const r = await post(`/identities/${id}/login`, {});
  if (!isResult(r)) throw new Error('resposta inesperada do daemon ao login');
  return { outcome: r.outcome, detail: r.detail };
}
