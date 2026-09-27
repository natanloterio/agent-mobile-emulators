import type { LocalParallelStatus } from '../live/types';

export const LOCAL_PARALLEL_MIN = 1;
export const LOCAL_PARALLEL_MAX = 8;

/** Texto do `<input type="number">` vira o valor gravado (inteiro, 1..8); fora da faixa é preso, vazio ou não numérico mantém o anterior. */
export function clampLocalParallelInput(raw: string, previous: number): number {
  if (raw.trim() === '') return previous;
  const n = Math.round(Number(raw));
  return Number.isFinite(n) ? Math.min(LOCAL_PARALLEL_MAX, Math.max(LOCAL_PARALLEL_MIN, n)) : previous;
}

export type LocalParallelStateKind = 'applied' | 'pending' | 'external';

/**
 * Estado mostrado abaixo do campo (spec paralelismo §UI): pendente (a frota ainda está ocupada) tem prioridade;
 * senão, Ollama externo/desconhecido (`applied.ollama` null) avisa para reiniciá-lo à mão; senão, aplicado.
 */
export function localParallelStateKind(s: Pick<LocalParallelStatus, 'pending' | 'applied'>): LocalParallelStateKind {
  if (s.pending) return 'pending';
  if (s.applied.ollama === null) return 'external';
  return 'applied';
}
