import type { IdentityRow } from '../db/identities.js';

/** Estados em que a identidade tem conta e não está com ninguém: a sonda do teste decide se está pronta. */
const ELIGIBLE = new Set(['idle', 'logged-in', 'restored', 'dirty', 'offline']);

/** Identidade para o tool-call canônico do "Testar conexão" (spec §4.4): prefere `idle`, nunca uma em uso ou bloqueada. */
export function pickTestIdentity(ids: readonly IdentityRow[]): IdentityRow | null {
  const free = ids.filter((i) => ELIGIBLE.has(i.state) && !i.paused && !i.controlled && !i.discardedAt);
  return free.find((i) => i.state === 'idle') ?? free[0] ?? null;
}
