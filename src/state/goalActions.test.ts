import { describe, expect, it, vi } from 'vitest';
import type { FleetAction } from './fleetReducer';
import { goalPlan, goalSummary } from './fixtures';
import { createGoalActions } from './goalActions';
import type { ApiBridge } from './apiRequest';

function setup(bridge: ApiBridge | undefined) {
  const actions: FleetAction[] = [];
  const created = createGoalActions({ dispatch: (a) => { actions.push(a); }, getBridge: () => bridge });
  return { actions, created };
}
const reply = (value: unknown) => vi.fn((_m: string, _p: string, _b?: unknown) => Promise.resolve(value));

describe('createGoalActions', () => {
  it('decompose: estágio 1, POST /goals/plan e planReady com o plano do líder', async () => {
    const plan = goalPlan();
    const api = reply(plan);
    const { actions, created } = setup({ api });
    await created.decompose('  Responder comentários  ');
    expect(api).toHaveBeenCalledWith('POST', '/goals/plan', { text: 'Responder comentários' });
    expect(actions).toEqual([
      { type: 'decomposeStart', fallbackText: 'Responder comentários' },
      { type: 'request', key: 'plan', phase: 'start' },
      { type: 'request', key: 'plan', phase: 'ok' },
      { type: 'planReady', plan },
    ]);
  });

  it('decompose: texto curto não chama o daemon', async () => {
    const api = reply(null);
    const { actions, created } = setup({ api });
    await created.decompose('ab');
    expect(api).not.toHaveBeenCalled();
    expect(actions).toEqual([{ type: 'requestError', key: 'plan', message: 'descreva o objetivo (mínimo 3 caracteres)' }]);
  });

  it('decompose: erro ou resposta fora do contrato mostram erro e voltam ao estágio 0', async () => {
    const bad = setup({ api: reply({ nope: 1 }) });
    await bad.created.decompose('objetivo');
    expect(bad.actions.slice(-2)).toEqual([
      { type: 'requestError', key: 'plan', message: 'resposta do daemon fora do contrato (plano)' },
      { type: 'planFailed' },
    ]);
    const err = setup({ api: vi.fn(() => Promise.reject(new Error('/goals/plan → 500: {"error":"sem identidades"}'))) });
    await err.created.decompose('objetivo');
    expect(err.actions.slice(-2)).toEqual([{ type: 'requestError', key: 'plan', message: 'sem identidades' }, { type: 'planFailed' }]);
  });

  it('launch: POST /goals com texto e plano; sucesso vai ao cockpit; 409 fica na tela', async () => {
    const plan = goalPlan();
    const api = reply({ goalId: 'g9' });
    const ok = setup({ api });
    await ok.created.launch(plan);
    expect(api).toHaveBeenCalledWith('POST', '/goals', { text: plan.text, plan });
    expect(ok.actions.at(-1)).toEqual({ type: 'launched' });
    const busy = setup({ api: vi.fn(() => Promise.reject(new Error('/goals → 409: {"error":"objetivo em execução"}'))) });
    await busy.created.launch(plan);
    expect(busy.actions.at(-1)).toEqual({ type: 'requestError', key: 'launch', message: 'objetivo em execução' });
    expect(busy.actions.some((a) => a.type === 'launched')).toBe(false);
  });

  it('loadGoals: GET /goals e goalsLoaded; formato inválido vira erro', async () => {
    const goals = [goalSummary()];
    const ok = setup({ api: reply({ goals }) });
    await ok.created.loadGoals();
    expect(ok.actions.at(-1)).toEqual({ type: 'goalsLoaded', goals });
    const bad = setup({ api: reply({ goals: 'x' }) });
    await bad.created.loadGoals();
    expect(bad.actions.at(-1)).toMatchObject({ type: 'requestError', key: 'goals' });
  });

  it('resume e kill chamam a bridge e guardam erro legível', async () => {
    const resume = vi.fn(() => Promise.reject(new Error("Error invoking remote method 'enxame:resume': Error: /resume → 500: {\"error\":\"boom\"}")));
    const kill = vi.fn(() => Promise.resolve());
    const { actions, created } = setup({ resume, kill });
    await created.resume(); await created.kill();
    expect(resume).toHaveBeenCalled(); expect(kill).toHaveBeenCalled();
    expect(actions).toContainEqual({ type: 'requestError', key: 'resume', message: 'boom' });
    expect(actions.at(-1)).toEqual({ type: 'request', key: 'kill', phase: 'ok' });
  });
});
