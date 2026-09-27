import type { StepBudgets } from '../live/types';
import { track, type ApiDeps } from './apiRequest';

export interface SettingsActions {
  /** Grava o patch (parcial) dos limites de passos no daemon; devolve se deu certo. */
  readonly saveBudgets: (patch: Partial<StepBudgets>) => Promise<boolean>;
}

/** Limites dos agentes (spec limites §UI): tela vive, grava no daemon e passa a valer na próxima tarefa/subtarefa. */
export function createSettingsActions(deps: ApiDeps): SettingsActions {
  return {
    saveBudgets: async (patch) => {
      const r = await track(deps, 'budgets', (b) => b.api?.('PUT', '/settings/budgets', patch));
      return r.ok;
    },
  };
}
