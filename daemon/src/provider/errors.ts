/** Classes novas do spec §7. `auth` já existia como Halt no worker; aqui é lançada antes de qualquer chamada. */
export class ProviderError extends Error {
  constructor(public readonly kind: 'auth' | 'infra-local', message: string) { super(message); this.name = 'ProviderError'; }
  static isInstance(e: unknown): e is ProviderError { return e instanceof ProviderError; }
}

/** Erro de API do provedor local no meio da tarefa (spec §7): Ollama caiu, recusou conexão ou estourou VRAM. */
export function isLocalInfraError(e: unknown): boolean {
  const x = e as { name?: string; statusCode?: number; message?: string } | null;
  if (!x) return false;
  const msg = String(x.message ?? '');
  const apiErr = x.name === 'AI_APICallError' || typeof x.statusCode === 'number';
  return apiErr && ((x.statusCode ?? 0) >= 500 || /ECONNREFUSED|ECONNRESET|fetch failed|out of memory|socket hang up/i.test(msg));
}
