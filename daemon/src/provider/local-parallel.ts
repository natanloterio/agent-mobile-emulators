import type { DatabaseSync } from 'node:sqlite';
import { readLocalParallel } from '../db/settings.js';
import type { RuntimeLock } from '../swarm/runtime-lock.js';

/** Estado publicado no snapshot (spec paralelismo §UI): pedido, o que cada runtime confirma e se falta aplicar. */
export interface LocalParallelStatus {
  readonly wanted: number;
  readonly applied: { readonly ollama: number | null; readonly lmstudio: number | null };
  readonly pending: boolean;
}

export interface LocalParallelDeps {
  readonly db: DatabaseSync;
  readonly ollama: { restartIfParallelDiffers(wanted: number): Promise<number | null> };
  readonly lmstudio: { reloadIfParallelDiffers(endpoint: string, wanted: number): Promise<number | null> };
  readonly lmstudioEndpoint: string;
  /** Nenhum objetivo nem subtarefa de missão rodando agora (spec paralelismo §Ocioso). */
  readonly isIdle: () => boolean;
  /**
   * A MESMA trava do single-flight de `ensure()` (`swarm/single-flight.ts`): a troca efetiva roda dentro dela, então
   * nenhum `ensure()` corre ao mesmo tempo que o restart do Ollama / reload do LM Studio (os dois mexem no mesmo
   * processo/modelo). Corrige a corrida: sem a trava, `apply()` reiniciaria o runtime por segundos–minutos enquanto
   * um worker tentava usá-lo ao mesmo tempo.
   */
  readonly lock: RuntimeLock;
}

export interface LocalParallelController {
  /**
   * Lê o valor gravado; com a frota ociosa (checado de novo dentro da trava, por segurança) aplica nos dois
   * runtimes agora (spec paralelismo §Ocioso); ocupada — antes ou depois de pegar a trava — só marca `pending`.
   * Chamado no PUT /settings/local e no fim de cada tarefa/subtarefa (se `pending`). Chamadas sobrepostas colapsam:
   * uma já em andamento faz a próxima só marcar `pending`, nunca dispara um segundo restart.
   */
  apply(): Promise<void>;
  status(): LocalParallelStatus;
}

/** `restartIfParallelDiffers`/`reloadIfParallelDiffers` nunca devem derrubar o apply do outro runtime. */
async function safely(p: Promise<number | null>): Promise<number | null> {
  try { return await p; } catch { return null; }
}

export function createLocalParallelController(d: LocalParallelDeps): LocalParallelController {
  let wanted = readLocalParallel(d.db);
  let applied: { ollama: number | null; lmstudio: number | null } = { ollama: null, lmstudio: null };
  let pending = false;
  // Guarda de reentrância (ponto d da revisão): um apply já em voo → a próxima chamada só marca pending e devolve,
  // nunca entra na fila da trava de novo (evita dois restarts concorrentes / duplicados).
  let inflight = false;

  const apply = async (): Promise<void> => {
    wanted = readLocalParallel(d.db); // mostra o alvo novo na tela na hora, mesmo antes de aplicar de verdade
    if (inflight) { pending = true; return; }
    if (!d.isIdle()) { pending = true; return; } // checagem barata: evita entrar na fila da trava à toa
    inflight = true;
    try {
      await d.lock.run(async () => {
        // Recheca ociosidade JÁ DENTRO da trava (ponto b da revisão): uma tarefa pode ter começado a rodar
        // enquanto esperava a vez atrás de um ensure() em andamento.
        if (!d.isIdle()) { pending = true; return; }
        const w = readLocalParallel(d.db); // pode ter mudado enquanto esperava a trava
        wanted = w;
        const [ollama, lmstudio] = await Promise.all([
          safely(d.ollama.restartIfParallelDiffers(w)),
          safely(d.lmstudio.reloadIfParallelDiffers(d.lmstudioEndpoint, w)),
        ]);
        applied = { ollama, lmstudio };
        pending = false;
      });
    } finally {
      inflight = false;
    }
  };

  return { apply, status: () => ({ wanted, applied, pending }) };
}
