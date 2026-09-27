export type SetupErrorKind = 'disk-full' | 'network' | 'checksum' | 'process';

/** Erro de instalação com o tipo que a tela usa para escolher a mensagem e a ação. */
export class SetupError extends Error {
  readonly kind: SetupErrorKind;
  constructor(kind: SetupErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.kind = kind;
  }
}

const NETWORK_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_SOCKET']);

/** Classifica qualquer erro: disco cheio e rede primeiro (valem para download, tar, sdkmanager e Ollama). */
export function toSetupError(e: unknown): SetupError {
  if (e instanceof SetupError) return e;
  const code = (e as { code?: string } | null)?.code;
  const msg = String((e as Error | null)?.message ?? e);
  if (code === 'ENOSPC' || /no space left on device/i.test(msg)) return new SetupError('disk-full', 'sem espaço em disco', { cause: e });
  if ((code && NETWORK_CODES.has(code)) || /fetch failed|network|socket hang up/i.test(msg)) return new SetupError('network', msg.slice(0, 300), { cause: e });
  return new SetupError('process', msg.slice(0, 300), { cause: e });
}
