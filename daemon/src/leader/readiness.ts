import type { DatabaseSync } from 'node:sqlite';
import { listIdentities, setIdentityFlags, type IdentityRow, type ProbeSignalsRow } from '../db/identities.js';
import type { ProbeResult } from '../device/probe.js';

/** Prontidão de uma identidade para o plano (spec inc. 5 §3.3: `signals`, `ready`, `readyLabel`). */
export interface Readiness {
  readonly identity: IdentityRow; readonly signals: ProbeSignalsRow | null; readonly ready: boolean; readonly readyLabel: string;
}
export type EnsureReady = (id: IdentityRow) => Promise<ProbeResult>;

const LABEL_DETAIL_MAX = 48;
const short = (s: string) => (s.length > LABEL_DETAIL_MAX ? `${s.slice(0, LABEL_DETAIL_MAX - 1)}…` : s);

/** Candidatas ao objetivo: nem descartadas nem banidas (spec inc. 5 §3.2). */
export function candidateIdentities(db: DatabaseSync): readonly IdentityRow[] {
  return listIdentities(db).filter((i) => !i.discardedAt && i.state !== 'banned');
}

/** Estado que dispensa a sonda: o humano está no comando, ou a identidade exige ação humana (spec §6: nunca retry). */
export function humanBlockLabel(i: IdentityRow): string | null {
  if (i.paused) return 'pausada';
  if (i.controlled) return 'sob controle humano';
  if (i.state === 'needs-human') return 'needs-human';
  if (i.state === 'banned') return 'banida';
  if (i.discardedAt) return 'descartada';
  return null;
}

export function probeLabel(r: ProbeResult): string {
  if (r.ready) return 'pronto';
  const s = r.signals;
  if (!s.versionMatch && s.bootCompleted && s.accessibility && s.mcpInitialize && s.toolsPresent) return 'versão mudou · fora';
  return `offline · ${short(r.details[0] ?? `sonda falhou (${r.failureClass ?? 'infra'})`)}`;
}

/** Sonda uma identidade (injetável), grava os sinais e devolve a prontidão. Nunca lança. */
export async function readinessOf(db: DatabaseSync, i: IdentityRow, ensureReady: EnsureReady): Promise<Readiness> {
  const blocked = humanBlockLabel(i);
  if (blocked) return { identity: i, signals: i.lastSignals ?? null, ready: false, readyLabel: blocked };
  try {
    const r = await ensureReady(i);
    setIdentityFlags(db, i.id, { lastSignals: r.signals });
    return { identity: i, signals: r.signals, ready: r.ready, readyLabel: probeLabel(r) };
  } catch (e) {
    return { identity: i, signals: null, ready: false, readyLabel: `offline · ${short(String((e as Error)?.message ?? e))}` };
  }
}

/** Sonda a frota candidata em paralelo (cada identidade tem o próprio serial e porta). */
export function probeFleet(db: DatabaseSync, ensureReady: EnsureReady): Promise<readonly Readiness[]> {
  return Promise.all(candidateIdentities(db).map((i) => readinessOf(db, i, ensureReady)));
}
