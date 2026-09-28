import { z } from 'zod';
import { isEmail } from '../base/google-account.js';
import { readBasePrep } from '../db/base-settings.js';
import type { Route } from './api.js';

const PrepareBody = z.object({ lang: z.string().min(2).max(16).optional() }).strict();
// Mensagens nunca repetem a senha recebida.
const GoogleBody = z.object({
  email: z.string().trim().refine(isEmail, 'e-mail inválido'),
  password: z.string().min(1, 'senha vazia').max(200, 'senha longa demais'),
}).strict();

export interface BaseRouteOps {
  /** Começa ou retoma o preparo (não espera terminar). */
  readonly prepare: (lang: string) => void;
  readonly saveGoogle: (email: string, password: string) => Promise<void>;
  /** "Continuar" depois de uma verificação humana (ou de uma pausa): segue a missão do celular-base e o preparo. */
  readonly continueMission: (missionId: string) => void;
  /** "Começar de novo": abandona a missão aberta do celular-base e zera o andamento. */
  readonly reset: () => void;
}

/**
 * Preparo do celular-base (sem Android Studio). `PUT /base/google` só pelo main (a senha não passa pelo canal genérico);
 * `POST /base/prepare` e `POST /base/continue` pela tela. O andamento vai no snapshot (`baseAvd.prep`).
 */
export function baseRoutes(o: BaseRouteOps): Route {
  let lang = 'pt';
  return async (ctx) => {
    const p = ctx.url.pathname;
    if (!p.startsWith('/base/')) return false;
    if (p === '/base/prepare' && ctx.method === 'POST') {
      const body = PrepareBody.safeParse((await ctx.body()) ?? {});
      if (!body.success) { ctx.send(400, { error: body.error.issues.map((i) => i.message) }); return true; }
      if (ctx.isKilled()) { ctx.send(409, { error: 'kill switch acionado: retome antes de preparar o celular-base' }); return true; }
      lang = body.data.lang ?? lang;
      o.prepare(lang);
      ctx.send(202, { preparing: true });
      return true;
    }
    if (p === '/base/continue' && ctx.method === 'POST') {
      const prep = readBasePrep(ctx.db);
      if (!['needs-human', 'failed'].includes(prep.state) || !prep.missionId) { ctx.send(409, { error: 'o preparo não está esperando uma verificação' }); return true; }
      try { o.continueMission(prep.missionId); } catch (e) { ctx.send(409, { error: String((e as Error).message ?? e) }); return true; }
      ctx.send(200, { continued: true }); ctx.broadcast();
      return true;
    }
    if (p === '/base/reset' && ctx.method === 'POST') {
      try { o.reset(); } catch (e) { ctx.send(409, { error: String((e as Error).message ?? e) }); return true; }
      ctx.send(200, { reset: true }); ctx.broadcast();
      return true;
    }
    if (p === '/base/google' && ctx.method === 'PUT') {
      const body = GoogleBody.safeParse(await ctx.body());
      if (!body.success) { ctx.send(400, { error: body.error.issues.map((i) => i.message) }); return true; }
      await o.saveGoogle(body.data.email, body.data.password);
      // Parado esperando a conta: segue sozinho.
      if (readBasePrep(ctx.db).state === 'needs-google') o.prepare(lang);
      ctx.send(204); ctx.broadcast();
      return true;
    }
    return false;
  };
}
