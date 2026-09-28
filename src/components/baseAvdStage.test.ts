import { describe, expect, it } from 'vitest';
import type { BasePrep } from '../live/types';
import { baseBlocksProvision, baseStage } from './baseAvdStage';

const prep = (state: BasePrep['state']): BasePrep => ({ state, phase: null, error: null, missionId: null, humanReason: null, progress: null });

describe('baseStage', () => {
  it('ausente; preparo ativo (inclusive parado ou com falha) vence; ligada por fora; pronta', () => {
    expect(baseStage({ name: 'g', found: false })).toBe('missing');
    expect(baseStage({ name: 'g', found: false, prep: prep('idle') })).toBe('missing');
    for (const s of ['running', 'needs-google', 'needs-human', 'failed'] as const) expect(baseStage({ name: 'g', found: true, running: true, prep: prep(s) })).toBe('preparing');
    expect(baseStage({ name: 'g', found: true, running: true, prep: prep('done') })).toBe('running');
    expect(baseStage({ name: 'g', found: true, running: false, prep: prep('done') })).toBeNull();
    expect(baseStage(null)).toBeNull();
  });
  it('qualquer estágio trava o provisionamento; pronta libera', () => {
    expect(['missing', 'preparing', 'running', null].map((s) => baseBlocksProvision(s as never))).toEqual([true, true, true, false]);
  });
});
