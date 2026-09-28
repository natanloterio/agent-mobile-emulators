import type { MissionIdentityOption } from './missionPick';

/** Uma etapa da sequência com arquivo (spec arquivos): conta e texto. `identityId` vazio = ainda não escolhida. */
export interface ChainStepDraft { readonly identityId: string; readonly text: string }

export const MIN_STEPS = 2;
export const MAX_STEPS = 10;

/** Duas etapas vazias; a primeira já com a primeira conta livre, a segunda com a próxima. */
export function initialSteps(options: readonly MissionIdentityOption[]): readonly ChainStepDraft[] {
  const free = options.filter((o) => !o.disabled).map((o) => o.id);
  return [{ identityId: free[0] ?? '', text: '' }, { identityId: free[1] ?? '', text: '' }];
}

export const addStep = (steps: readonly ChainStepDraft[]): readonly ChainStepDraft[] =>
  (steps.length >= MAX_STEPS ? steps : [...steps, { identityId: '', text: '' }]);

export const removeStep = (steps: readonly ChainStepDraft[], k: number): readonly ChainStepDraft[] =>
  (steps.length <= MIN_STEPS ? steps : steps.filter((_, i) => i !== k));

export const setStep = (steps: readonly ChainStepDraft[], k: number, patch: Partial<ChainStepDraft>): readonly ChainStepDraft[] =>
  steps.map((s, i) => (i === k ? { ...s, ...patch } : s));

/** Contas que a etapa `k` pode escolher: livres e não usadas em outra etapa (a própria escolha fica). */
export function optionsForStep(options: readonly MissionIdentityOption[], steps: readonly ChainStepDraft[], k: number): readonly MissionIdentityOption[] {
  const taken = new Set(steps.filter((_, i) => i !== k).map((s) => s.identityId).filter(Boolean));
  return options.filter((o) => !o.disabled && !taken.has(o.id));
}

/** Pronta para iniciar: ≥ 2 etapas, todas com conta livre distinta e texto (o daemon checa o mínimo de caracteres). */
export function canStartChain(options: readonly MissionIdentityOption[], steps: readonly ChainStepDraft[]): boolean {
  const free = new Set(options.filter((o) => !o.disabled).map((o) => o.id));
  const ids = steps.map((s) => s.identityId);
  return steps.length >= MIN_STEPS && ids.every((id) => free.has(id)) && new Set(ids).size === ids.length && steps.every((s) => s.text.trim().length > 0);
}
