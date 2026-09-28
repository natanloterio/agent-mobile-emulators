import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { baseAvdStatus, localContextFrom, pickBaseAvd, stepBudgetFrom } from '../src/config.js';

describe('pickBaseAvd', () => {
  it('env vence; senão a dourada (a nova, depois a de antes da troca de nome); senão o AVD da conta1', () => {
    expect(pickBaseAvd('outra', '/h', () => true)).toBe('outra');
    const golden = path.join('/h', 'tapflock_golden.avd');
    const legacyGolden = path.join('/h', 'enxame_golden.avd');
    expect(pickBaseAvd(undefined, '/h', (p) => p === golden || p === legacyGolden)).toBe('tapflock_golden');
    expect(pickBaseAvd(undefined, '/h', (p) => p === legacyGolden)).toBe('enxame_golden');
    expect(pickBaseAvd(undefined, '/h', () => false)).toBe('mcp_test_playstore');
  });
});

describe('baseAvdStatus', () => {
  it('diz se a base existe; sem nenhuma, o nome a criar é a dourada (não o AVD antigo da conta1)', () => {
    const at = (name: string) => path.join('/h', `${name}.avd`);
    expect(baseAvdStatus(undefined, '/h', (p) => p === at('tapflock_golden'))).toEqual({ name: 'tapflock_golden', found: true });
    expect(baseAvdStatus(undefined, '/h', (p) => p === at('mcp_test_playstore'))).toEqual({ name: 'mcp_test_playstore', found: true });
    expect(baseAvdStatus(undefined, '/h', () => false)).toEqual({ name: 'tapflock_golden', found: false });
    expect(baseAvdStatus('minha_base', '/h', () => false)).toEqual({ name: 'minha_base', found: false });
  });
});

describe('stepBudgetFrom (TAPFLOCK_STEP_BUDGET / TAPFLOCK_MISSION_STEP_BUDGET)', () => {
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

describe('localContextFrom (TAPFLOCK_LOCAL_CONTEXT)', () => {
  it('ausente, lixo ou pequeno demais (<8192) caem no padrão 65536; inteiro ≥8192 vale', () => {
    expect(localContextFrom(undefined)).toBe(65536);
    expect(localContextFrom('')).toBe(65536);
    expect(localContextFrom('abc')).toBe(65536);
    expect(localContextFrom('4096')).toBe(65536);
    expect(localContextFrom('131072')).toBe(131072);
    expect(localContextFrom('8192')).toBe(8192);
  });
});
