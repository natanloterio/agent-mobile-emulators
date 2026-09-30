import type { StepLike } from '../worker/record.js';

/** Parte `tool-call` do ai@7 com a flag que o SDK põe quando input/nome não validam. */
interface MaybeInvalidCall { readonly type: string; readonly toolCallId?: string; readonly invalid?: boolean }

/** Spec inc. 3 §4.1: mensagens de validação do servidor MCP (`Parameter '<x>' must …`, `Missing required parameter …`), com ou sem os prefixos do wrapper/errText. */
export const PARAM_ERROR_RE = /(?:^|: )(?:Parameter '[^']+' must|Missing required parameter)/;
export const isParamError = (text: string): boolean => PARAM_ERROR_RE.test(text);

interface MaybeToolError { readonly type: string; readonly toolCallId?: string; readonly error?: unknown }
const errorText = (e: unknown): string => (e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e) ?? '');

export function invalidCallIds(step: StepLike): readonly string[] {
  const schemaInvalid = step.content
    .filter((p): p is MaybeInvalidCall & { toolCallId: string } => p.type === 'tool-call' && (p as MaybeInvalidCall).invalid === true && typeof (p as MaybeInvalidCall).toolCallId === 'string')
    .map((p) => p.toolCallId);
  const paramErrors = step.content
    .filter((p): p is MaybeToolError & { toolCallId: string } => p.type === 'tool-error' && typeof (p as MaybeToolError).toolCallId === 'string' && isParamError(errorText((p as MaybeToolError).error)))
    .map((p) => p.toolCallId);
  return [...new Set([...schemaInvalid, ...paramErrors])];
}

/**
 * O modelo escreveu a chamada como texto (`{"name": …, "arguments": …}`, às vezes num bloco ```json) em vez de chamar a
 * tool: acontece com modelos locais e o passo termina sem ação. Medido no gpt-oss:20b numa missão de 2026-09-30.
 */
export function isTextToolCall(step: StepLike): boolean {
  if (step.content.some((p) => p.type === 'tool-call')) return false;
  const body = step.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  if (!body.startsWith('{')) return false;
  try {
    // Com o envelope ({name, arguments}) ou só os argumentos ({"ok":true,"did":…}): um objeto JSON solto no lugar da
    // resposta nunca é útil ao executor, que só age por tools.
    const v = JSON.parse(body) as unknown;
    return !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0;
  } catch { return false; }
}

/**
 * O servidor local (Ollama) não conseguiu ler a chamada que o modelo gerou e a requisição inteira falhou, às vezes
 * depois das novas tentativas do SDK (RetryError). O passo nem chega ao onStepFinish, então só dá para ver pelo erro.
 */
export function isToolParseError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : '';
  return /error parsing tool call|failed to parse tool call/i.test(msg);
}

export interface QualityFloor {
  readonly limit: number;
  observe(step: StepLike): number;
  /** Dispara o piso na hora (ex.: o servidor local recusou a chamada do modelo). */
  trip(): void;
  tripped(): boolean;
  count(): number;
}

/**
 * Spec §4.5: acumulado por tarefa; tool calls inválidas no schema e erros de parâmetro do servidor contam; negação do
 * gate, erros de nó e de infra não. Chamada escrita como texto dispara na hora: o passo acaba sem ação e o modelo
 * repete o formato no pedido final, então só o escalonamento resolve.
 */
export function createQualityFloor(limit = 3): QualityFloor {
  let n = 0;
  return {
    limit,
    observe: (step) => { n = isTextToolCall(step) ? Math.max(n + 1, limit) : n + invalidCallIds(step).length; return n; },
    trip: () => { n = Math.max(n + 1, limit); },
    tripped: () => n >= limit,
    count: () => n,
  };
}
