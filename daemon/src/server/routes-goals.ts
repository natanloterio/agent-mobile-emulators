import { z } from 'zod';
import { LANGS, type Lang } from '../leader/lang.js';
import type { GoalPlan } from '../leader/types.js';
import { GoalText, type Route } from './api.js';

/** `lang` opcional: idioma da interface, em que o líder escreve justificativa e instruções. */
const PlanBody = z.object({ text: GoalText, lang: z.enum(LANGS).optional() });

export interface GoalsRoutesOpts {
  /** Líder + sonda da frota (produção: `planGoal`). */
  readonly plan: (text: string, lang?: Lang) => Promise<GoalPlan>;
}

/**
 * `POST /goals/plan {text, lang?}` → GoalPlan (spec inc. 5 §3.2). 400 corpo inválido; 409 com objetivo em execução
 * ou outro planejamento em curso (dois planos sondariam os mesmos devices ao mesmo tempo).
 */
export function goalsRoutes(o: GoalsRoutesOpts): Route {
  return async (ctx) => {
    if (ctx.method !== 'POST' || ctx.url.pathname !== '/goals/plan') return false;
    const parsed = PlanBody.safeParse(await ctx.body());
    if (!parsed.success) { ctx.send(400, { error: parsed.error.issues.map((i) => i.message) }); return true; }
    // Mesmo lock do objetivo e do teste de provedor: a sonda do plano não pode correr sobre workers ativos.
    const release = ctx.lock();
    if (!release) { ctx.send(409, { error: 'objetivo, teste ou planejamento em execução' }); return true; }
    try {
      const plan = await o.plan(parsed.data.text, parsed.data.lang);
      ctx.send(200, plan);
    } catch (e) {
      console.error('[daemon] planejamento falhou:', e);
      ctx.send(500, { error: String((e as Error)?.message ?? e) });
    } finally { release(); }
    ctx.broadcast(); // a sonda gravou sinais e estados novos
    return true;
  };
}
