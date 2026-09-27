import { z } from 'zod';
import { LANGS } from '../leader/lang.js';
import { addNote } from '../db/mission-notes.js';
import { getMission, OPEN_MISSION_STATES } from '../db/missions.js';
import { MissionError, type MissionRunner } from '../mission/runner.js';
import { GoalText, type Route } from './api.js';

const StartBody = z.object({ identityId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'identidade inválida'), text: GoalText, lang: z.enum(LANGS).optional() });
const ACTION = /^\/missions\/([A-Za-z0-9-]{1,64})\/(pause|resume|continue|abandon)$/;
const INSTRUCT = /^\/missions\/([A-Za-z0-9-]{1,64})\/instruct$/;
/** `then` roda a mesma transição da ação dedicada; sem ele, a instrução só é gravada. */
const InstructBody = z.object({ text: z.string(), then: z.enum(['continue', 'resume']).optional() });
const NOTE_MAX = 1000;

/** Rotas de missão (spec missões §API). Não usam o lock de objetivo: missões rodam em paralelo aos objetivos. */
export function missionRoutes(o: {
  readonly runner: MissionRunner;
  /** Máscara dos segredos da missão (spec instruções): a instrução do operador nunca grava um segredo em claro. */
  readonly mask: (missionId: string) => Promise<(s: string) => string>;
}): Route {
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
    const instruct = INSTRUCT.exec(ctx.url.pathname);
    if (instruct) {
      const [, id] = instruct;
      const body = InstructBody.safeParse(await ctx.body());
      const text = body.success ? body.data.text.trim() : '';
      if (!body.success || !text || text.length > NOTE_MAX) { ctx.send(400, { error: 'texto inválido' }); return true; }
      const mission = getMission(ctx.db, id);
      if (!mission) { ctx.send(404, { error: 'missão desconhecida' }); return true; }
      if (!OPEN_MISSION_STATES.includes(mission.state)) { ctx.send(409, { error: 'missão já encerrada' }); return true; }
      const mask = await o.mask(id);
      const noteId = addNote(ctx.db, id, mask(text));
      guard(() => {
        const missionState = body.data.then === 'continue' ? o.runner.continue(id) : body.data.then === 'resume' ? o.runner.resume(id) : mission.state;
        ctx.send(200, { noteId, missionState });
        ctx.broadcast();
      });
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
