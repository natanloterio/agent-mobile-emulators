import { BASE_IDENTITY_ID } from '../db/identities.js';
import { z } from 'zod';
import { LANGS } from '../leader/lang.js';
import { addNote } from '../db/mission-notes.js';
import { getMission, OPEN_MISSION_STATES } from '../db/missions.js';
import { MissionError, type MissionRunner } from '../mission/runner.js';
import { GoalText, type Route } from './api.js';

const IdentityId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'identidade inválida').refine((id) => id !== BASE_IDENTITY_ID, 'identidade reservada ao celular-base');
const MAX_IDENTITIES = 50;
/** Uma identidade (`identityId`, corpo antigo) ou várias (`identityIds`: a mesma missão em cada device). */
const StartBody = z.union([
  z.object({ identityId: IdentityId, text: GoalText, lang: z.enum(LANGS).optional() }).strict(),
  z.object({ identityIds: z.array(IdentityId).min(1).max(MAX_IDENTITIES), text: GoalText, lang: z.enum(LANGS).optional() }).strict(),
]);
interface StartFail { readonly identityId: string; readonly error: string; readonly status: 404 | 409 }
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
      const { text, lang = 'pt' } = parsed.data;
      if ('identityId' in parsed.data) {
        const { identityId } = parsed.data;
        guard(() => { const goalId = o.runner.start(identityId, text, lang); ctx.send(201, { goalId }); ctx.broadcast(); });
        return true;
      }
      // Cada identidade é uma missão independente: a recusa de uma (ocupada, pausada…) não barra as outras.
      const started: { identityId: string; goalId: string }[] = [];
      const failed: StartFail[] = [];
      for (const identityId of new Set(parsed.data.identityIds)) {
        try { started.push({ identityId, goalId: o.runner.start(identityId, text, lang) }); }
        catch (e) {
          if (!(e instanceof MissionError)) throw e;
          failed.push({ identityId, error: e.message, status: e.status });
        }
      }
      // Nenhuma iniciada: só `{error}` (a UI lê essa forma), com o motivo de cada identidade.
      if (started.length === 0) ctx.send(failed[0].status, { error: failed.map((f) => `${f.identityId}: ${f.error}`).join('; ') });
      else { ctx.send(201, { started, failed: failed.map(({ identityId, error }) => ({ identityId, error })) }); ctx.broadcast(); }
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
      // A máscara lê o cofre (await): a missão pode ter sido encerrada nesse meio-tempo.
      const now = getMission(ctx.db, id);
      if (!now || !OPEN_MISSION_STATES.includes(now.state)) { ctx.send(409, { error: 'missão já encerrada' }); return true; }
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
