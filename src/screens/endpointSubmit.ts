/**
 * Endpoint editado só vira PUT quando muda, ou quando o card mostra erro: reenviar o valor válido
 * depois de um `ftp://x` recusado é um PUT sem efeito que limpa o erro (plano, passo b).
 */
export function shouldSubmitEndpoint(value: string, current: string, error: string | null): boolean {
  return value !== current || error !== null;
}
