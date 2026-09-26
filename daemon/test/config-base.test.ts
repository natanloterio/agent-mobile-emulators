import { describe, expect, it } from 'vitest';
import { pickBaseAvd } from '../src/config.js';

describe('pickBaseAvd', () => {
  it('env vence; senão a dourada se existir; senão o AVD da conta1', () => {
    expect(pickBaseAvd('outra', '/h', () => true)).toBe('outra');
    expect(pickBaseAvd(undefined, '/h', (p) => p === '/h/enxame_golden.avd')).toBe('enxame_golden');
    expect(pickBaseAvd(undefined, '/h', () => false)).toBe('mcp_test_playstore');
  });
});
