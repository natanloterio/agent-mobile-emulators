import { describe, expect, it } from 'vitest';
import { buildMissionFinishMessages, MISSION_FINISH_STEPS, MISSION_FINISH_TOOLS, shouldRunMissionFinish } from '../src/worker/mission-finish.js';

describe('shouldRunMissionFinish', () => {
  const base = { mission: true, report: null, halted: false, stopped: false, budget: 60 as number | null, stepsUsed: 5 };
  it('roda em missão, sem relatório, sem halt, sem parada e com orçamento de sobra', () => {
    expect(shouldRunMissionFinish(base)).toBe(true);
  });
  it('não roda fora de missão', () => {
    expect(shouldRunMissionFinish({ ...base, mission: false })).toBe(false);
  });
  it('não roda se já há relatório', () => {
    expect(shouldRunMissionFinish({ ...base, report: { ok: true, did: 'x', blockers: '' } })).toBe(false);
  });
  it('não roda com halt ou parada (kill/pausa)', () => {
    expect(shouldRunMissionFinish({ ...base, halted: true })).toBe(false);
    expect(shouldRunMissionFinish({ ...base, stopped: true })).toBe(false);
  });
  it('não roda com orçamento esgotado; roda se o orçamento é null (desligado)', () => {
    expect(shouldRunMissionFinish({ ...base, budget: 5, stepsUsed: 5 })).toBe(false);
    expect(shouldRunMissionFinish({ ...base, budget: null, stepsUsed: 999 })).toBe(true);
  });
});

describe('buildMissionFinishMessages', () => {
  it('concatena histórico + resposta do segmento anterior + o pedido final', () => {
    const history = [{ role: 'user' as const, content: 'oi' }];
    const response = [{ role: 'assistant' as const, content: 'ok' }];
    const out = buildMissionFinishMessages(history, response, 'encerre agora');
    expect(out).toEqual([...history, ...response, { role: 'user', content: 'encerre agora' }]);
  });
});

describe('constantes do pedido final', () => {
  it('só finish_subtask e request_human, no máximo 2 passos', () => {
    expect(MISSION_FINISH_TOOLS).toEqual(['finish_subtask', 'request_human']);
    expect(MISSION_FINISH_STEPS).toBe(2);
  });
});
