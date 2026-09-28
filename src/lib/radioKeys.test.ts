import { describe, expect, it } from 'vitest';
import { radioKeyTarget } from './radioKeys';

describe('radioKeyTarget', () => {
  it('setas andam e dão a volta; pulam desabilitadas; Home/End vão às pontas', () => {
    expect(radioKeyTarget('ArrowRight', 0, 3)).toBe(1);
    expect(radioKeyTarget('ArrowDown', 2, 3)).toBe(0);
    expect(radioKeyTarget('ArrowLeft', 0, 3)).toBe(2);
    expect(radioKeyTarget('ArrowDown', 1, 4, (i) => i === 2)).toBe(3);
    expect(radioKeyTarget('End', 0, 4, (i) => i === 3)).toBe(2);
    expect(radioKeyTarget('Home', 3, 4)).toBe(0);
    expect(radioKeyTarget('Enter', 0, 3)).toBeNull();
  });
});
