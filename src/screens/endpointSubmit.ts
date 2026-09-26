/**
 * Endpoint editado só vira PUT quando muda, ou quando há erro do último PUT: reenviar o valor válido
 * depois de um `ftp://x` recusado é um PUT sem efeito que limpa o erro (plano, passo b).
 * Recebe só o erro de PUT: erro de carga da lista ("Ollama parado") não dispara reenvio.
 */
export function shouldSubmitEndpoint(value: string, current: string, error: string | null): boolean {
  return value !== current || error !== null;
}
