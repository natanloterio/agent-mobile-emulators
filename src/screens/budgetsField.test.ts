import { describe, expect, it } from 'vitest';
import { BUDGET_MAX, BUDGET_MIN, budgetFieldFrom, budgetFieldToPatchValue, clampBudgetInput } from './budgetsField';

describe('budgetFieldFrom', () => {
  it('número vira o campo com "sem limite" desmarcado', () => {
    expect(budgetFieldFrom(45, 30)).toEqual({ value: 45, unlimited: false });
  });
  it('null vira "sem limite" marcado; o campo mostra o fallback (não fica vazio)', () => {
    expect(budgetFieldFrom(null, 30)).toEqual({ value: 30, unlimited: true });
  });
});

describe('clampBudgetInput', () => {
  it('inteiro dentro da faixa passa direto', () => {
    expect(clampBudgetInput('45', 30)).toBe(45);
  });
  it('fora da faixa é preso em 1..1000', () => {
    expect(clampBudgetInput('0', 30)).toBe(BUDGET_MIN);
    expect(clampBudgetInput('-5', 30)).toBe(BUDGET_MIN);
    expect(clampBudgetInput('5000', 30)).toBe(BUDGET_MAX);
  });
  it('decimal arredonda; não numérico mantém o valor anterior', () => {
    expect(clampBudgetInput('2.6', 30)).toBe(3);
    expect(clampBudgetInput('abc', 30)).toBe(30);
    expect(clampBudgetInput('', 30)).toBe(30);
  });
});

describe('budgetFieldToPatchValue', () => {
  it('"sem limite" manda null; senão o número do campo', () => {
    expect(budgetFieldToPatchValue({ value: 45, unlimited: false })).toBe(45);
    expect(budgetFieldToPatchValue({ value: 45, unlimited: true })).toBeNull();
  });
});
