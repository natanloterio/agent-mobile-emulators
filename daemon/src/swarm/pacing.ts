import type { DatabaseSync } from 'node:sqlite';
import { ACTION_TOOL } from '../worker/tools.js';

/** Pacing (spec §4.3): atraso com jitter entre passos e teto de ações/hora por identidade. */
export interface PacingConfig { readonly stepDelayMs: number; readonly stepJitterMs: number; readonly maxActionsPerHour: number }
export interface PacingClock { sleep(ms: number): Promise<void>; random(): number; now(): number }
/** `stop` = a identidade foi parada (kill, pausa, controle) enquanto o pacer esperava: o passo não deve agir. */
export interface Pacer { beforeStep(): Promise<'go' | 'stop'> }

const HOUR_MS = 3_600_000;
/** Espera máxima de uma vez quando o teto bate: re-checa parada (kill/pausa/controle) a cada fatia. */
const MAX_WAIT_SLICE_MS = 60_000;
const MIN_WAIT_MS = 1000;

export const REAL_CLOCK: PacingClock = { sleep: (ms) => new Promise<void>((r) => setTimeout(r, ms)), random: Math.random, now: Date.now };

/** Mesmo formato de `datetime('now')` do SQLite (UTC, sem fuso), para comparar texto com texto. */
export function toSqliteUtc(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}
const fromSqliteUtc = (at: string): number => Date.parse(`${at.replace(' ', 'T')}Z`);

/** `stepDelayMs` ± `stepJitterMs`, uniforme; nunca negativo. */
export function stepDelayMs(cfg: PacingConfig, random: () => number): number {
  return Math.max(0, Math.round(cfg.stepDelayMs + (random() * 2 - 1) * cfg.stepJitterMs));
}

/** Instantes (ms) das ações desta identidade na última hora, mais velho primeiro. Leitura, pesquisa e ledger não contam. */
export function recentActionTimes(db: DatabaseSync, identityId: string, now: number): readonly number[] {
  const rows = db.prepare(`select s.tool, s.started_at from step s join task t on t.id = s.task_id
    where t.identity_id = ? and s.started_at >= ? order by s.started_at`).all(identityId, toSqliteUtc(now - HOUR_MS)) as { tool: string | null; started_at: string }[];
  return rows.filter((r) => r.tool !== null && ACTION_TOOL.test(r.tool)).map((r) => fromSqliteUtc(r.started_at));
}

/**
 * Pacer de um worker. O primeiro passo não espera (o start já foi escalonado pelo scheduler).
 * `maxActionsPerHour` ≤ 0 desliga o teto. Ao bater o teto, espera a ação mais velha sair da janela.
 */
export function createPacer(
  db: DatabaseSync, identityId: string, cfg: PacingConfig,
  o: { readonly shouldStop: () => boolean; readonly clock?: Partial<PacingClock> },
): Pacer {
  const clock: PacingClock = { ...REAL_CLOCK, ...o.clock };
  let calls = 0;
  const waitForCap = async (): Promise<'go' | 'stop'> => {
    if (cfg.maxActionsPerHour <= 0) return 'go';
    for (;;) {
      if (o.shouldStop()) return 'stop';
      const now = clock.now();
      const times = recentActionTimes(db, identityId, now);
      if (times.length < cfg.maxActionsPerHour) return 'go';
      // Sai da janela a ação que libera uma vaga: a (n - max)-ésima mais velha.
      const freeAt = times[times.length - cfg.maxActionsPerHour] + HOUR_MS;
      await clock.sleep(Math.min(MAX_WAIT_SLICE_MS, Math.max(MIN_WAIT_MS, freeAt - now + MIN_WAIT_MS)));
    }
  };
  return {
    async beforeStep() {
      if (calls++ > 0) { const d = stepDelayMs(cfg, clock.random); if (d > 0) await clock.sleep(d); }
      if (o.shouldStop()) return 'stop';
      return waitForCap();
    },
  };
}
