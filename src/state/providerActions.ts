import type { Dispatch } from 'react';
import { modelFor } from '../data/providers';
import type { EnxameBridge, ProviderPatch } from '../live/types';
import type { ProviderMode, RoleKey } from '../types/fleet';
import type { FleetAction } from './fleetReducer';

/**
 * O IPC do Electron embrulha como `Error invoking remote method 'canal': Error: /providers/x → 409: {"error":"…"}`;
 * a tela mostra só a linha legível.
 */
export const bridgeMessage = (e: Error) => e.message
  .replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '')
  .replace(/^.*→ \d+: /, '')
  .replace(/^\{"error":"|"\}$/g, '');

export type ProviderBridge = Partial<Pick<EnxameBridge, 'setProvider' | 'testProvider' | 'getProviderModels'>>;

export interface ProviderActionDeps {
  readonly dispatch: Dispatch<FleetAction>;
  /** Lido a cada chamada: sem bridge (Vite no browser) as ações seguem o mock. */
  readonly getBridge: () => ProviderBridge | undefined;
  /** Modo corrente do papel no estado local, para a lista mock sem daemon. */
  readonly getMode: (role: RoleKey) => ProviderMode;
}

export interface ProviderActions {
  readonly pickMode: (role: RoleKey, mode: ProviderMode) => void;
  readonly testConnection: (role: RoleKey) => void;
  readonly setProviderField: (role: RoleKey, patch: Omit<ProviderPatch, 'mode'>) => void;
  readonly loadProviderModels: (role: RoleKey) => void;
}

/** Ações da tela Provedores que dependem da bridge; puras em relação ao React para poderem ser testadas em node. */
export function createProviderActions({ dispatch, getBridge, getMode }: ProviderActionDeps): ProviderActions {
  const putError = (role: RoleKey, message: string | null) => dispatch({ type: 'providerError', role, message });
  const modelsError = (role: RoleKey, message: string | null) => dispatch({ type: 'providerModelsError', role, message });

  const loadProviderModels = (role: RoleKey) => {
    const get = getBridge()?.getProviderModels;
    // Sem daemon o seletor mostra a lista mock do papel (spec §4.5).
    if (!get) { dispatch({ type: 'providerModels', role, models: [modelFor(role, getMode(role))] }); return; }
    get(role).then((r) => {
      // Catálogo local só quando o daemon o manda (daemon antigo: a tela segue só com `models`).
      const catalog = r.entries || r.runtimes ? { entries: r.entries, runtimes: r.runtimes } : {};
      dispatch({ type: 'providerModels', role, models: r.models, ...catalog });
      // Lista limpa apaga o erro de carga anterior (ex.: "Ollama parado"); erro novo substitui.
      modelsError(role, r.error);
    }).catch((e: Error) => modelsError(role, bridgeMessage(e)));
  };

  return {
    // Com daemon: persiste no registro; a tela recarrega a lista quando o modo muda (efeito do Providers).
    pickMode: (role, mode) => {
      const set = getBridge()?.setProvider;
      if (!set) { dispatch({ type: 'pickMode', role, mode }); return; }
      // 409 (frota ocupada) ou 400 não mudam o modo: o erro aparece no card do papel.
      set(role, { mode }).then(() => {
        dispatch({ type: 'pickMode', role, mode });
        putError(role, null);
      }).catch((e: Error) => putError(role, bridgeMessage(e)));
    },
    setProviderField: (role, patch) => {
      const set = getBridge()?.setProvider; if (!set) return;
      set(role, patch)
        .then(() => {
          putError(role, null);
          // Trocar o runtime troca o endpoint do papel: o erro de carga e o "atual" da lista mudam.
          if (patch.runtime) loadProviderModels(role);
        })
        .catch((e: Error) => putError(role, bridgeMessage(e)));
    },
    loadProviderModels,
    // O teste pode ter subido o Ollama: ao terminar, a lista e o erro de carga são relidos.
    testConnection: (role) => {
      dispatch({ type: 'testStart', role });
      const test = getBridge()?.testProvider;
      if (!test) return;
      test(role).catch(() => undefined).finally(() => {
        dispatch({ type: 'testDone', role });
        loadProviderModels(role);
      });
    },
  };
}
