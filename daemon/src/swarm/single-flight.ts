import type { OllamaSupervisor } from '../provider/ollama.js';

/**
 * Vários workers do enxame chamam `ensure` quase juntos; com o Ollama parado, cada um subiria o seu `ollama serve`.
 * Chamadas concorrentes com o mesmo endpoint/modelo compartilham a mesma promessa; a seguinte, depois dela, checa de novo.
 */
export function singleFlightOllama(sup: OllamaSupervisor): OllamaSupervisor {
  const inflight = new Map<string, ReturnType<OllamaSupervisor['ensure']>>();
  return {
    ...sup,
    ensure: (endpoint, model, runtime) => {
      const key = `${runtime ?? ''}|${endpoint}|${model}`;
      const cur = inflight.get(key);
      if (cur) return cur;
      const p = sup.ensure(endpoint, model, runtime).finally(() => { inflight.delete(key); });
      inflight.set(key, p);
      return p;
    },
  };
}
