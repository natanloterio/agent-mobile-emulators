import { describe, expect, it } from 'vitest';
import { addStep, canStartChain, initialSteps, MAX_STEPS, optionsForStep, removeStep, setStep } from './chainSteps';

const opt = (id: string, disabled = false) => ({ id, name: id, handle: `@${id}`, disabled, note: '' });
const options = [opt('c1'), opt('c2', true), opt('c3'), opt('c4')];

describe('etapas da sequência', () => {
  it('começa com duas etapas nas duas primeiras contas livres', () => {
    expect(initialSteps(options)).toEqual([{ identityId: 'c1', text: '' }, { identityId: 'c3', text: '' }]);
    expect(initialSteps([opt('c1')])).toEqual([{ identityId: 'c1', text: '' }, { identityId: '', text: '' }]);
  });
  it('adiciona até o máximo e remove sem ficar abaixo de 2', () => {
    let s = initialSteps(options);
    s = addStep(s); expect(s).toHaveLength(3);
    expect(removeStep(s, 0).map((x) => x.identityId)).toEqual(['c3', '']);
    expect(removeStep(initialSteps(options), 0)).toHaveLength(2);
    let many = initialSteps(options); for (let i = 0; i < 20; i++) many = addStep(many);
    expect(many).toHaveLength(MAX_STEPS);
  });
  it('cada etapa só vê contas livres que nenhuma outra escolheu', () => {
    const s = initialSteps(options);
    expect(optionsForStep(options, s, 0).map((o) => o.id)).toEqual(['c1', 'c4']);
    expect(optionsForStep(options, s, 1).map((o) => o.id)).toEqual(['c3', 'c4']);
  });
  it('pode iniciar só com contas livres distintas e texto em todas', () => {
    let s = initialSteps(options);
    expect(canStartChain(options, s)).toBe(false);
    s = setStep(setStep(s, 0, { text: 'baixe' }), 1, { text: 'poste' });
    expect(canStartChain(options, s)).toBe(true);
    expect(canStartChain(options, setStep(s, 1, { identityId: 'c1' }))).toBe(false);
    expect(canStartChain(options, setStep(s, 1, { identityId: 'c2' }))).toBe(false);
    expect(canStartChain(options, setStep(s, 1, { text: '   ' }))).toBe(false);
  });
});
