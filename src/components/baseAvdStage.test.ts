import { describe, expect, it } from 'vitest';
import { baseBlocksProvision, baseStage } from './baseAvdStage';

describe('baseStage', () => {
  it('ausente, ligada, pronta; some quando já há frota e a base está pronta', () => {
    expect(baseStage({ name: 'g', found: false }, false)).toBe('missing');
    expect(baseStage({ name: 'g', found: true, running: true }, true)).toBe('running');
    expect(baseStage({ name: 'g', found: true, running: false }, false)).toBe('ready');
    expect(baseStage({ name: 'g', found: true }, true)).toBeNull();
    expect(baseStage(null, false)).toBeNull();
  });
  it('só ausente ou ligada travam o provisionamento', () => {
    expect(['missing', 'running', 'ready', null].map((s) => baseBlocksProvision(s as never))).toEqual([true, true, false, false]);
  });
});
