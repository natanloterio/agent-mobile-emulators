import { z } from 'zod';
import { writeLocalParallel } from '../db/settings.js';
import type { LocalParallelController } from '../provider/local-parallel.js';
import type { Route } from './api.js';

const LocalParallelBody = z.object({ parallel: z.number().int().min(1).max(8) }).strict();

export interface LocalParallelRoutesOpts {
  readonly controller: LocalParallelController;
}

/**
 * `GET/PUT /settings/local {parallel}` (spec paralelismo §UI): gerações simultâneas no modelo local, 1..8.
 * `PUT` grava e chama `apply()` — com a frota ociosa a troca no Ollama/LM Studio já acontece; ocupada, fica
 * pendente até o fim da tarefa/subtarefa corrente (spec §Ocioso). Broadcast no PUT como os outros settings.
 */
export function localParallelRoutes(o: LocalParallelRoutesOpts): Route {
  return async (ctx) => {
    if (ctx.url.pathname !== '/settings/local') return false;
    if (ctx.method === 'GET') { ctx.send(200, o.controller.status()); return true; }
    if (ctx.method !== 'PUT') return false;
    const parsed = LocalParallelBody.safeParse(await ctx.body());
    if (!parsed.success) { ctx.send(400, { error: parsed.error.issues.map((i) => i.message) }); return true; }
    writeLocalParallel(ctx.db, parsed.data.parallel);
    await o.controller.apply();
    ctx.send(200, o.controller.status());
    ctx.broadcast();
    return true;
  };
}
