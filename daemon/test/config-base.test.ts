import { describe, expect, it } from 'vitest';
import { pickBaseAvd, positiveIntOr } from '../src/config.js';

describe('pickBaseAvd', () => {
  it('env vence; senão a dourada se existir; senão o AVD da conta1', () => {
    expect(pickBaseAvd('outra', '/h', () => true)).toBe('outra');
    expect(pickBaseAvd(undefined, '/h', (p) => p === '/h/enxame_golden.avd')).toBe('enxame_golden');
    expect(pickBaseAvd(undefined, '/h', () => false)).toBe('mcp_test_playstore');
  });
});

describe('positiveIntOr (ENXAME_MISSION_STEP_BUDGET)', () => {
  it('ausente, NaN, zero ou negativo → padrão; positivo → o valor', () => {
    expect(positiveIntOr(undefined, 60)).toBe(60);
    expect(positiveIntOr('abc', 60)).toBe(60);
    expect(positiveIntOr('0', 60)).toBe(60);
    expect(positiveIntOr('-5', 60)).toBe(60);
    expect(positiveIntOr('', 60)).toBe(60);
    expect(positiveIntOr('25', 60)).toBe(25);
  });
});
