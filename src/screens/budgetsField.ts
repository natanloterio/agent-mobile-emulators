export const BUDGET_MIN = 1;
export const BUDGET_MAX = 1000;

/** Um campo de limite: número visível + "sem limite" marcado ou não (o número some do PUT, mas fica na tela). */
export interface BudgetField { readonly value: number; readonly unlimited: boolean }

/** Estado inicial do campo a partir do valor do snapshot: `null` vira "sem limite", com `fallback` no número visível. */
export function budgetFieldFrom(current: number | null, fallback: number): BudgetField {
  return { value: current ?? fallback, unlimited: current === null };
}

/** Texto do `<input type="number">` vira o valor gravado (inteiro, 1..1000); fora da faixa é preso, vazio ou não numérico mantém o anterior. */
export function clampBudgetInput(raw: string, previous: number): number {
  if (raw.trim() === '') return previous;
  const n = Math.round(Number(raw));
  return Number.isFinite(n) ? Math.min(BUDGET_MAX, Math.max(BUDGET_MIN, n)) : previous;
}

/** O que vai no PUT: "sem limite" manda `null`; senão o número do campo. */
export function budgetFieldToPatchValue(f: BudgetField): number | null {
  return f.unlimited ? null : f.value;
}
