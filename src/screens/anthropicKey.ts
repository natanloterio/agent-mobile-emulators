import { z } from 'zod';
import type { MessageKey } from '../i18n/messages';

const KeyStatusSchema = z.object({ configured: z.boolean(), source: z.enum(['env', 'vault']).nullable() });
export type KeyStatus = z.infer<typeof KeyStatusSchema>;

/** `GET /settings/anthropic-key` pelo main: diz se há chave e de onde veio, nunca o valor. */
export function parseKeyStatus(raw: unknown): KeyStatus | null {
  const r = KeyStatusSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/** Linha de estado do cartão: sem chave com papel na nuvem é o caso que para a frota, então vira erro. */
export function keyNotice(s: KeyStatus, anyCloudRole: boolean): { readonly key: MessageKey; readonly tone: 'error' | 'info' } {
  if (!s.configured) return anyCloudRole ? { key: 'providers.key.missingNeeded', tone: 'error' } : { key: 'providers.key.missing', tone: 'info' };
  return { key: s.source === 'env' ? 'providers.key.fromEnv' : 'providers.key.fromVault', tone: 'info' };
}
