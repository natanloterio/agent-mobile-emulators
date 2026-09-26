/** Classes novas do spec §7. `auth` já existia como Halt no worker; aqui é lançada antes de qualquer chamada. */
export class ProviderError extends Error {
  constructor(public readonly kind: 'auth' | 'infra-local', message: string) { super(message); this.name = 'ProviderError'; }
  static isInstance(e: unknown): e is ProviderError { return e instanceof ProviderError; }
}
