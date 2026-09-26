import { describe, expect, it } from 'vitest';
import { createInitialState } from './fleetReducer';
import { goalPlan } from './fixtures';
import { selectDemoPlanVM, selectPlanVM } from './planView';
import { selectTiles } from './selectors';

describe('selectPlanVM — plano real do líder', () => {
  it('padrão, rationale, estimativa e custo do líder', () => {
    const vm = selectPlanVM(goalPlan());
    expect(vm.patternLabel).toBe('Fan-out replicado');
    expect(vm.rationale).toBe('Trabalho preso à conta.');
    expect(vm.estimate).toEqual([
      { label: 'Tarefas prontas', value: '1' },
      { label: 'Fora da sonda', value: '1' },
      { label: 'Orçamento de passos', value: '30 por conta' },
      { label: 'Frota pronta em', value: '~43 s · starts escalonados' },
      { label: 'Líder', value: 'claude-sonnet-5 · US$ 0,01' },
    ]);
    expect(vm.leaderWarning).toBeNull();
    expect(selectPlanVM(goalPlan({ pattern: 'sharding' })).patternLabel).toBe('Sharding');
  });
  it('tarefas com os 5 sinais reais na ordem da sonda e readyLabel do daemon', () => {
    const [a, b] = selectPlanVM(goalPlan()).tasks;
    expect(a).toEqual({ key: 'conta1', name: 'conta1', handle: '@a', instr: 'Responder a própria caixa', signals: [true, true, true, true, true], ready: true, readyLabel: 'pronto' });
    expect(b.signals).toEqual([true, true, true, true, false]); expect(b.ready).toBe(false);
    const none = selectPlanVM(goalPlan({ tasks: [{ ...goalPlan().tasks[0], signals: null, ready: false, readyLabel: 'sem sonda' }] })).tasks[0];
    expect(none.signals).toEqual([false, false, false, false, false]);
  });
  it('erro do líder vira aviso de regra determinística', () => {
    const vm = selectPlanVM(goalPlan({ leader: { model: 'claude-sonnet-5', costUsd: 0, error: 'auth: chave ausente' } }));
    expect(vm.leaderWarning).toBe('Líder indisponível, regra determinística (auth: chave ausente)');
  });
});

describe('selectDemoPlanVM — demo mantém o design', () => {
  it('fan-out com as tarefas da frota demo', () => {
    const tiles = selectTiles(createInitialState(), 8);
    const vm = selectDemoPlanVM(tiles, 8);
    expect(vm.patternLabel).toBe('Fan-out replicado');
    expect(vm.tasks).toHaveLength(8);
    expect(vm.tasks.find((t) => t.name === 'conta7')?.signals.filter(Boolean)).toHaveLength(4);
    expect(vm.leaderWarning).toBeNull();
  });
});
