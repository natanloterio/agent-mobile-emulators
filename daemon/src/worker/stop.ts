import type { DatabaseSync } from 'node:sqlite';
import { getIdentity } from '../db/identities.js';

/** Pausa ou controle humano desta identidade (spec inc. 5 §3.2): o worker para no próximo passo. Identidade sumida também para. */
export function humanStopped(db: DatabaseSync, identityId: string): boolean {
  const id = getIdentity(db, identityId);
  return !id || !!id.paused || !!id.controlled;
}

/**
 * Worker interrompido por pausa/controle: só desfaz o 'running' que ele mesmo gravou (vira 'idle').
 * Flags `paused`/`controlled`, `last_error` e qualquer estado que o humano tenha posto (ex.: needs-human) ficam como estão.
 */
export function settleIdentity(db: DatabaseSync, identityId: string): void {
  db.prepare("update identity set state='idle', updated_at=datetime('now') where id=? and state='running'").run(identityId);
}
