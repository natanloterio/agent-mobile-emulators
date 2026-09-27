import { z } from 'zod';
import { readStepBudgets, writeStepBudgets } from '../db/settings.js';
import type { Route } from './api.js';

const StepBudgetField = z.union([z.number().int().min(1).max(1000), z.null()]);
export const BudgetsPatch = z.object({ goal: StepBudgetField.optional(), mission: StepBudgetField.optional() }).strict();

/**
 * Limites de passos ajustáveis na tela (spec limites §UI), sem reiniciar o daemon: cada tarefa/subtarefa nova lê
 * o valor do banco. `GET` devolve o estado atual; `PUT` grava o patch (parcial) e avisa a UI pelo WS.
 */
export function settingsRoutes(): Route {
  return async (ctx) => {
    if (ctx.url.pathname !== '/settings/budgets') return false;
    if (ctx.method === 'GET') { ctx.send(200, readStepBudgets(ctx.db)); return true; }
    if (ctx.method !== 'PUT') return false;
    const parsed = BudgetsPatch.safeParse(await ctx.body());
    if (!parsed.success) { ctx.send(400, { error: parsed.error.issues.map((i) => i.message) }); return true; }
    const next = writeStepBudgets(ctx.db, parsed.data);
    ctx.send(200, next);
    ctx.broadcast();
    return true;
  };
}
