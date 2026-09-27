import { z } from 'zod';
import { LANGS } from '../leader/lang.js';
import { MissionError, type MissionRunner } from '../mission/runner.js';
import { GoalText, type Route } from './api.js';

const StartBody = z.object({ identityId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'identidade inválida'), text: GoalText, lang: z.enum(LANGS).optional() });
const ACTION = /^\/missions\/([A-Za-z0-9-]{1,64})\/(pause|resume|continue|abandon)$/;

/** Rotas de missão (spec missões §API). Não usam o lock de objetivo: missões rodam em paralelo aos objetivos. */
export function missionRoutes(o: { readonly runner: MissionRunner }): Route {
  return async (ctx) => {
    if (ctx.method !== 'POST') return false;
    const guard = (fn: () => void) => {
      try { fn(); } catch (e) { if (e instanceof MissionError) ctx.send(e.status, { error: e.message }); else throw e; }
    };
    if (ctx.url.pathname === '/missions') {
      const parsed = StartBody.safeParse(await ctx.body());
      if (!parsed.success) { ctx.send(400, { error: parsed.error.issues.map((i) => i.message) }); return true; }
      guard(() => { const goalId = o.runner.start(parsed.data.identityId, parsed.data.text, parsed.data.lang ?? 'pt'); ctx.send(201, { goalId }); ctx.broadcast(); });
      return true;
    }
    const m = ACTION.exec(ctx.url.pathname);
    if (!m) return false;
    const [, id, action] = m;
    guard(() => {
      const r = action === 'pause' ? o.runner.pause(id) : action === 'resume' ? o.runner.resume(id) : action === 'continue' ? o.runner.continue(id) : o.runner.abandon(id);
      ctx.send(200, { missionState: r }); ctx.broadcast();
    });
    return true;
  };
}
