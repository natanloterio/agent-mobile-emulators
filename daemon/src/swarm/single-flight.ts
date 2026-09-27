import type { OllamaSupervisor } from '../provider/ollama.js';
import type { RuntimeLock } from './runtime-lock.js';

/**
 * Vários workers do enxame chamam `ensure` quase juntos; com o Ollama parado, cada um subiria o seu `ollama serve`.
 * Chamadas concorrentes com o mesmo endpoint/modelo compartilham a mesma promessa; a seguinte, depois dela, checa de novo.
 *
 * `lock` é a MESMA trava usada pelo `applyLocalParallel` (spec paralelismo §Ocioso): todo `ensure()` roda dentro dela,
 * então uma troca de paralelismo em andamento (restart do Ollama / reload do LM Studio) segura a vez de qualquer
 * `ensure()` novo até terminar — os dois mexem no mesmo processo/modelo e nunca podem correr ao mesmo tempo.
 */
export function singleFlightOllama(sup: OllamaSupervisor, lock: RuntimeLock): OllamaSupervisor {
  const inflight = new Map<string, ReturnType<OllamaSupervisor['ensure']>>();
  return {
    ...sup,
    ensure: (endpoint, model, runtime) => {
      const key = `${runtime ?? ''}|${endpoint}|${model}`;
      const cur = inflight.get(key);
      if (cur) return cur;
      const p = lock.run(() => sup.ensure(endpoint, model, runtime)).finally(() => { inflight.delete(key); });
      inflight.set(key, p);
      return p;
    },
  };
}
