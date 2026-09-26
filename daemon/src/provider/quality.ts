import type { StepLike } from '../worker/record.js';

/** Parte `tool-call` do ai@7 com a flag que o SDK põe quando input/nome não validam. */
interface MaybeInvalidCall { readonly type: string; readonly toolCallId?: string; readonly invalid?: boolean }

export function invalidCallIds(step: StepLike): readonly string[] {
  return step.content
    .filter((p): p is MaybeInvalidCall & { toolCallId: string } => p.type === 'tool-call' && (p as MaybeInvalidCall).invalid === true && typeof (p as MaybeInvalidCall).toolCallId === 'string')
    .map((p) => p.toolCallId);
}

export interface QualityFloor {
  readonly limit: number;
  observe(step: StepLike): number;
  tripped(): boolean;
  count(): number;
}

/** Spec §4.5: acumulado por tarefa; só tool calls inválidas contam. Negação do gate e erros de infra não são culpa do modelo. */
export function createQualityFloor(limit = 3): QualityFloor {
  let n = 0;
  return {
    limit,
    observe: (step) => { n += invalidCallIds(step).length; return n; },
    tripped: () => n >= limit,
    count: () => n,
  };
}
