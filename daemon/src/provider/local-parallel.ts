import type { DatabaseSync } from 'node:sqlite';
import { readLocalParallel } from '../db/settings.js';

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
}

export interface LocalParallelController {
  /**
   * Lê o valor gravado; com a frota ociosa aplica nos dois runtimes agora (spec paralelismo §Ocioso); ocupada,
   * só marca `pending`. Chamado no PUT /settings/local e no fim de cada tarefa/subtarefa (se `pending`).
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

  return {
    apply: async () => {
      wanted = readLocalParallel(d.db);
      if (!d.isIdle()) { pending = true; return; }
      const [ollama, lmstudio] = await Promise.all([
        safely(d.ollama.restartIfParallelDiffers(wanted)),
        safely(d.lmstudio.reloadIfParallelDiffers(d.lmstudioEndpoint, wanted)),
      ]);
      applied = { ollama, lmstudio };
      pending = false;
    },
    status: () => ({ wanted, applied, pending }),
  };
}
