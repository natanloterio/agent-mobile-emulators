import { describe, expect, it } from 'vitest';
import { localContextFrom, pickBaseAvd, stepBudgetFrom } from '../src/config.js';

describe('pickBaseAvd', () => {
  it('env vence; senão a dourada se existir; senão o AVD da conta1', () => {
    expect(pickBaseAvd('outra', '/h', () => true)).toBe('outra');
    expect(pickBaseAvd(undefined, '/h', (p) => p === '/h/enxame_golden.avd')).toBe('enxame_golden');
    expect(pickBaseAvd(undefined, '/h', () => false)).toBe('mcp_test_playstore');
  });
});

describe('stepBudgetFrom (ENXAME_STEP_BUDGET / ENXAME_MISSION_STEP_BUDGET)', () => {
  it('"0" desliga o orçamento (null); inteiro positivo vale; o resto cai no padrão', () => {
    expect(stepBudgetFrom('0', 60)).toBeNull();
    expect(stepBudgetFrom('45', 60)).toBe(45);
    expect(stepBudgetFrom(undefined, 60)).toBe(60);
    expect(stepBudgetFrom('abc', 60)).toBe(60);
    expect(stepBudgetFrom('-3', 60)).toBe(60);
    expect(stepBudgetFrom('2.5', 60)).toBe(60);
    expect(stepBudgetFrom('', 60)).toBe(60);
  });
});

describe('localContextFrom (ENXAME_LOCAL_CONTEXT)', () => {
  it('ausente, lixo ou pequeno demais (<8192) caem no padrão 65536; inteiro ≥8192 vale', () => {
    expect(localContextFrom(undefined)).toBe(65536);
    expect(localContextFrom('')).toBe(65536);
    expect(localContextFrom('abc')).toBe(65536);
    expect(localContextFrom('4096')).toBe(65536);
    expect(localContextFrom('131072')).toBe(131072);
    expect(localContextFrom('8192')).toBe(8192);
  });
});
