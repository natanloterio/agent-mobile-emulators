import { describe, expect, it } from 'vitest';
import { createInitialState, fleetReducer, requestOf } from './fleetReducer';
import { goalPlan, goalSummary } from './fixtures';

describe('fleetReducer — requisições ao daemon (incremento 5)', () => {
  it('start marca ocupado e limpa erro; ok encerra; erro guarda a mensagem', () => {
    const s0 = createInitialState();
    const s1 = fleetReducer(s0, { type: 'request', key: 'plan', phase: 'start' });
    expect(requestOf(s1, 'plan')).toEqual({ busy: true, error: null });
    const s2 = fleetReducer(s1, { type: 'requestError', key: 'plan', message: 'líder caiu' });
    expect(requestOf(s2, 'plan')).toEqual({ busy: false, error: 'líder caiu' });
    const s3 = fleetReducer(s2, { type: 'request', key: 'plan', phase: 'start' });
    expect(requestOf(s3, 'plan').error).toBeNull();
    expect(requestOf(fleetReducer(s3, { type: 'request', key: 'plan', phase: 'ok' }), 'plan')).toEqual({ busy: false, error: null });
    expect(requestOf(s0, 'plan')).toEqual({ busy: false, error: null });
    expect(s0.requests).toEqual({});
  });
  it('planReady só vale durante a decomposição; setGoal descarta o plano', () => {
    const s0 = fleetReducer(createInitialState(), { type: 'decomposeStart', fallbackText: 'x' });
    const s1 = fleetReducer(s0, { type: 'planReady', plan: goalPlan() });
    expect(s1.planStage).toBe(2); expect(s1.plan?.pattern).toBe('fan-out');
    // Resposta atrasada depois de editar o texto não reabre o plano.
    const edited = fleetReducer(s0, { type: 'setGoal', text: 'outro' });
    expect(fleetReducer(edited, { type: 'planReady', plan: goalPlan() })).toBe(edited);
    const back = fleetReducer(s1, { type: 'setGoal', text: 'novo' });
    expect(back.plan).toBeNull(); expect(back.planStage).toBe(0);
    expect(fleetReducer(s1, { type: 'resetPlan' }).plan).toBeNull();
  });
  it('planFailed volta ao estágio 0 só se estava decompondo', () => {
    const s0 = fleetReducer(createInitialState(), { type: 'decomposeStart', fallbackText: 'x' });
    expect(fleetReducer(s0, { type: 'planFailed' }).planStage).toBe(0);
    const idle = createInitialState();
    expect(fleetReducer(idle, { type: 'planFailed' })).toBe(idle);
  });
  it('launched vai ao cockpit e zera plano e texto, sem mexer nas identidades', () => {
    const s0 = fleetReducer(fleetReducer(createInitialState('new'), { type: 'decomposeStart', fallbackText: 'x' }), { type: 'planReady', plan: goalPlan() });
    const s1 = fleetReducer(s0, { type: 'launched' });
    expect(s1).toMatchObject({ screen: 'cockpit', planStage: 0, plan: null, goalText: '' });
    expect(s1.ids).toBe(s0.ids);
  });
  it('goalsLoaded guarda a lista de objetivos anteriores', () => {
    const s1 = fleetReducer(createInitialState(), { type: 'goalsLoaded', goals: [goalSummary()] });
    expect(s1.pastGoals?.map((g) => g.id)).toEqual(['g1']);
    expect(createInitialState().pastGoals).toBeNull();
  });
});
