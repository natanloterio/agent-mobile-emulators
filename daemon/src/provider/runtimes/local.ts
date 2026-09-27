import { LOCAL_ENDPOINTS, runtimeForEndpoint, type LocalRuntimeKind } from '../config.js';
import type { OllamaSupervisor } from '../ollama.js';
import type { LmStudio } from './lmstudio.js';
import { listOllama as defaultListOllama } from './ollama-models.js';
import type { RuntimeListing, RuntimeStatus } from './types.js';

export interface LocalRuntimesDeps {
  readonly ollama: OllamaSupervisor;
  readonly lmstudio: Pick<LmStudio, 'ensure' | 'stop' | 'list'>;
  readonly listOllama?: (endpoint: string) => Promise<RuntimeListing>;
}

/**
 * Runtimes locais atrás da cara do supervisor do Ollama (spec runtimes-locais): `ensure(endpoint, model, runtime?)`.
 * Sem runtime explícito, a porta decide (1234 → LM Studio). `listAll` junta os modelos baixados de todos os runtimes.
 */
export interface LocalRuntimes extends OllamaSupervisor {
  ensure(endpoint: string, model: string, runtime?: LocalRuntimeKind | null): Promise<RuntimeStatus>;
  listAll(current?: { runtime?: LocalRuntimeKind | null; endpoint?: string }): Promise<readonly RuntimeListing[]>;
}

export function createLocalRuntimes(d: LocalRuntimesDeps): LocalRuntimes {
  const listOllama = d.listOllama ?? ((e: string) => defaultListOllama(e));
  return {
    ...d.ollama,
    ensure: (endpoint, model, runtime) => ((runtime ?? runtimeForEndpoint(endpoint)) === 'lmstudio'
      ? d.lmstudio.ensure(endpoint, model) : d.ollama.ensure(endpoint, model)),
    stop: () => { d.ollama.stop(); d.lmstudio.stop(); },
    listAll: async (current) => {
      const ep = (k: LocalRuntimeKind) => (current?.runtime === k && current.endpoint ? current.endpoint : LOCAL_ENDPOINTS[k]);
      return Promise.all([listOllama(ep('ollama')), d.lmstudio.list(ep('lmstudio'))]);
    },
  };
}
