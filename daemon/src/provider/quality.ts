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

export interface QualityFloor {
  readonly limit: number;
  observe(step: StepLike): number;
  tripped(): boolean;
  count(): number;
}

/** Spec §4.5: acumulado por tarefa; tool calls inválidas no schema e erros de parâmetro do servidor contam; negação do gate, erros de nó e de infra não. */
export function createQualityFloor(limit = 3): QualityFloor {
  let n = 0;
  return {
    limit,
    observe: (step) => { n += invalidCallIds(step).length; return n; },
    tripped: () => n >= limit,
    count: () => n,
  };
}
