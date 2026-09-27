import { z } from 'zod';
import { getIdentity } from '../db/identities.js';
import { clearCredential, credentialStatus, putCredential } from '../vault/credentials.js';
import { VaultError, type Vault } from '../vault/vault.js';
import type { Route, RouteCtx } from './api.js';

const ID_ROUTE = /^\/identities\/([A-Za-z0-9_-]{1,64})\/credentials$/;
// Mensagens nunca repetem o valor recebido (a senha).
const Creds = z.object({ username: z.string().trim().min(1, 'usuário obrigatório').max(100, 'usuário longo demais'), password: z.string().min(1, 'senha obrigatória').max(200, 'senha longa demais') });
const ImportBody = z.object({ entries: z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) }).and(Creds)).max(500) });
const issues = (e: z.ZodError) => e.issues.map((i) => i.message).join('; ');

async function vaultCall(ctx: RouteCtx, fn: () => Promise<void>, okCode: number, okBody?: unknown): Promise<void> {
  try { await fn(); ctx.send(okCode, okBody); }
  catch (e) { if (e instanceof VaultError) ctx.send(503, { error: e.message }); else throw e; }
}

/**
 * Credenciais de login no cofre do daemon (spec missões §Cofre). Fora da lista do canal genérico do Electron:
 * só o main as chama. Nenhuma resposta traz senha.
 */
export function credentialRoutes(o: { readonly vault: Vault }): Route {
  return async (ctx) => {
    if (ctx.method === 'GET' && ctx.url.pathname === '/credentials') {
      const available = await o.vault.available();
      const entries = available.ok ? await credentialStatus(o.vault) : {};
      ctx.send(200, { available, entries }); return true;
    }
    if (ctx.method === 'POST' && ctx.url.pathname === '/credentials/import') {
      const parsed = ImportBody.safeParse(await ctx.body());
      if (!parsed.success) { ctx.send(400, { error: issues(parsed.error) }); return true; }
      const known = parsed.data.entries.filter((e) => getIdentity(ctx.db, e.id));
      await vaultCall(ctx, async () => { for (const e of known) await putCredential(o.vault, e.id, { username: e.username, password: e.password }); }, 200, { imported: known.length });
      return true;
    }
    const m = ID_ROUTE.exec(ctx.url.pathname);
    if (!m || (ctx.method !== 'PUT' && ctx.method !== 'DELETE')) return false;
    const id = m[1];
    if (!getIdentity(ctx.db, id)) { ctx.send(404, { error: 'identidade desconhecida' }); return true; }
    if (ctx.method === 'DELETE') { await vaultCall(ctx, () => clearCredential(o.vault, id), 204); return true; }
    const parsed = Creds.safeParse(await ctx.body());
    if (!parsed.success) { ctx.send(400, { error: issues(parsed.error) }); return true; }
    await vaultCall(ctx, () => putCredential(o.vault, id, parsed.data), 204);
    ctx.broadcast();
    return true;
  };
}
