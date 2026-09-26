import { z } from 'zod';
import { getIdentity, setIdentityFlags } from '../db/identities.js';
import { AdbError } from '../device/adb.js';
import { InputError, InputGestureSchema, type DeviceInput } from '../device/input.js';
import type { Route } from './api.js';

const ROUTE = /^\/identities\/([^/]+)\/(control|input)$/;
const ControlBody = z.object({ on: z.boolean() });
const issues = (e: z.ZodError) => e.issues.map((i) => `${i.path.join('.') || 'corpo'}: ${i.message}`);

/**
 * Controle humano (spec inc. 5 §3.2). `control` só grava o flag `controlled`: o scheduler/worker lê o banco
 * e para aquela identidade. `input` só é aceito com controle ligado.
 */
export function controlRoutes(deps: { readonly input: Pick<DeviceInput, 'send'> }): Route {
  return async (ctx) => {
    const m = ctx.method === 'POST' ? ROUTE.exec(ctx.url.pathname) : null;
    if (!m) return false;
    const id = decodeURIComponent(m[1]);
    const identity = getIdentity(ctx.db, id);
    if (!identity) { ctx.send(404, { error: 'identidade desconhecida' }); return true; }
    const body = await ctx.body();

    if (m[2] === 'control') {
      const parsed = ControlBody.safeParse(body);
      if (!parsed.success) { ctx.send(400, { error: issues(parsed.error) }); return true; }
      setIdentityFlags(ctx.db, id, { controlled: parsed.data.on });
      ctx.send(200, { id, controlled: parsed.data.on }); ctx.broadcast();
      return true;
    }

    const parsed = InputGestureSchema.safeParse(body);
    if (!parsed.success) { ctx.send(400, { error: issues(parsed.error) }); return true; }
    if (!identity.controlled) { ctx.send(409, { error: 'identidade sem controle humano; ligue o controle antes' }); return true; }
    try {
      await deps.input.send(identity.serial, parsed.data);
      ctx.send(204);
    } catch (e) {
      if (e instanceof InputError) ctx.send(e.kind === 'invalid' ? 400 : 502, { error: e.message });
      else if (e instanceof AdbError) ctx.send(502, { error: e.message });
      else throw e;
    }
    return true;
  };
}
