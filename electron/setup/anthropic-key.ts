export interface KeyTestResult { readonly result: 'ok' | 'invalid' | 'network' }

/** "Testar chave": a menor chamada autenticada da API. A chave só vai no cabeçalho, nunca em log. */
export async function testAnthropicKey(key: string, fetchFn: typeof fetch = fetch): Promise<KeyTestResult> {
  try {
    const r = await fetchFn('https://api.anthropic.com/v1/models?limit=1', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } });
    if (r.ok) return { result: 'ok' };
    return { result: r.status === 401 || r.status === 403 ? 'invalid' : 'network' };
  } catch {
    return { result: 'network' };
  }
}
