import { z } from 'zod';
import type { ApiKeyStore } from '../provider/api-key.js';
import { VaultError } from '../vault/vault.js';
import type { Route } from './api.js';
import { issues } from './routes-credentials.js';

// Mensagens nunca repetem o valor recebido (a chave).
export const AnthropicKeyBody = z.object({
  key: z.string().trim().min(20, 'chave curta demais').max(300, 'chave longa demais').startsWith('sk-ant-', 'a chave da Anthropic começa com sk-ant-'),
}).strict();

/**
 * Chave da Anthropic no cofre (spec onboarding). Fora da lista do canal genérico do Electron: só o main chama,
 * no fim do onboarding. `GET` diz se há chave e de onde veio; nenhuma resposta traz o valor.
 */
export function anthropicKeyRoutes(o: { readonly store: ApiKeyStore }): Route {
  return async (ctx) => {
    if (ctx.url.pathname !== '/settings/anthropic-key') return false;
    if (ctx.method === 'GET') { ctx.send(200, { configured: o.store.current() !== '', source: o.store.source() }); return true; }
    if (ctx.method !== 'PUT') return false;
    const parsed = AnthropicKeyBody.safeParse(await ctx.body());
    if (!parsed.success) { ctx.send(400, { error: issues(parsed.error) }); return true; }
    try {
      await o.store.set(parsed.data.key);
      ctx.send(204);
    } catch (e) {
      if (!(e instanceof VaultError)) throw e;
      ctx.send(503, { error: e.message });
    }
    return true;
  };
}
