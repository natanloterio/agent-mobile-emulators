import { describe, expect, it } from 'vitest';
import { createInitialState } from './fleetReducer';
import { goalPlan } from './fixtures';
import { createI18n } from '../i18n/translate';
import { localizePlanVM, readyLabelText, selectDemoPlanVM, selectPlanVM } from './planView';
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

describe('planView em outros idiomas', () => {
  const en = createI18n('en');
  it('plano do líder em inglês: padrão, estimativa, readyLabel do daemon e aviso', () => {
    const vm = selectPlanVM(goalPlan({ leader: { model: 'claude-sonnet-5', costUsd: 0.013, error: 'auth' } }), en);
    expect(vm.patternLabel).toBe('Replicated fan-out');
    expect(vm.rationale).toBe('Trabalho preso à conta.'); // vem do líder, já no idioma pedido
    expect(vm.estimate).toEqual([
      { label: 'Ready tasks', value: '1' },
      { label: 'Failed the probe', value: '1' },
      { label: 'Step budget', value: '30 per account' },
      { label: 'Fleet ready in', value: '~43 s · staggered starts' },
      { label: 'Leader', value: 'claude-sonnet-5 · $0.01' },
    ]);
    expect(vm.tasks.map((t) => t.readyLabel)).toEqual(['ready', 'version changed · out']);
    expect(vm.leaderWarning).toBe('Leader unavailable, deterministic rule (auth)');
  });
  it('readyLabelText: rótulos fixos traduzidos, detalhe do offline intacto, estado cru e desconhecido passam', () => {
    const zh = createI18n('zh');
    expect(readyLabelText('pausada', en)).toBe('paused');
    expect(readyLabelText('sob controle humano', zh)).toBe('人工控制中');
    expect(readyLabelText('aguardando login', createI18n('de'))).toBe('wartet auf Anmeldung');
    expect(readyLabelText('banida', en)).toBe('banned');
    expect(readyLabelText('descartada', en)).toBe('discarded');
    expect(readyLabelText("offline · adb: device 'emulator-5558' not found", zh)).toBe("离线 · adb: device 'emulator-5558' not found");
    expect(readyLabelText('needs-human', zh)).toBe('needs-human');
    expect(readyLabelText('sem sonda', en)).toBe('sem sonda');
    expect(readyLabelText('pronto')).toBe('pronto');
  });
  it('localizePlanVM refaz o plano (vivo e demo) no idioma pedido', () => {
    expect(localizePlanVM(selectPlanVM(goalPlan()), en)).toEqual(selectPlanVM(goalPlan(), en));
    const tiles = selectTiles(createInitialState(), 8);
    const demo = localizePlanVM(selectDemoPlanVM(tiles, 8), createI18n('de'));
    expect(demo.patternLabel).toBe('Replizierter Fan-out');
    expect(demo.estimate[0]).toEqual({ label: 'Aufgaben', value: '7 von 8 (1 nicht bestanden)' });
    expect(demo.tasks.find((t) => t.name === 'conta7')?.readyLabel).toBe('Version geändert · raus');
    expect(demo.tasks[0].instr).toBe('Kommentare im eigenen Postfach beantworten, letzte 24 h');
  });
});
