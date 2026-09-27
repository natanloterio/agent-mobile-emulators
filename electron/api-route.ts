/** Rotas que o renderer pode chamar pelo canal genérico `enxame:api` (spec inc. 5 §3.4). Tudo o mais é recusado. */
const ALLOWED: readonly { readonly method: 'GET' | 'POST' | 'PUT'; readonly path: RegExp }[] = [
  { method: 'GET', path: /^\/state$/ },
  { method: 'GET', path: /^\/goals$/ },
  { method: 'POST', path: /^\/goals$/ },
  { method: 'POST', path: /^\/goals\/plan$/ },
  { method: 'POST', path: /^\/kill$/ },
  { method: 'POST', path: /^\/resume$/ },
  { method: 'POST', path: /^\/identities$/ },
  { method: 'POST', path: /^\/identities\/[A-Za-z0-9_-]{1,64}\/(?:pin|boot|login-done|pause|resolve|ban|discard|restore|rebaseline|control|input)$/ },
  // Missões (spec missões §API).
  { method: 'POST', path: /^\/missions$/ },
  { method: 'POST', path: /^\/missions\/[A-Za-z0-9-]{1,64}\/(?:pause|resume|continue|abandon)$/ },
];

export type ApiMethod = 'GET' | 'POST' | 'PUT';

/** Valida método e caminho vindos do renderer; lança em qualquer coisa fora da lista (inclusive `?`, `..`, `//`). */
export function apiRoute(method: string, path: string): { method: ApiMethod; path: string } {
  if (typeof method !== 'string' || typeof path !== 'string') throw new Error('rota inválida');
  const m = method.toUpperCase();
  const ok = ALLOWED.some((r) => r.method === m && r.path.test(path));
  if (!ok) throw new Error(`rota não permitida: ${m} ${JSON.stringify(path)}`);
  return { method: m as ApiMethod, path };
}
