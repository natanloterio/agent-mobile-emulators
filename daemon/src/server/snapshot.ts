import type { DatabaseSync } from 'node:sqlite';
import { CONFIG } from '../config.js';
import { listIdentities, type IdentityRow, type ProbeSignalsRow } from '../db/identities.js';
import { readProviderConfig, type ProviderRow, type RoleKey } from '../provider/config.js';
import { lastProviderTests, type ProviderTest } from '../provider/probe.js';
import type { VideoState } from '../device/video.js';

export interface ToolRow { readonly idx: number; readonly tool: string; readonly excerpt: string; readonly tokens: number; readonly gate: boolean; readonly provider: string | null }
export interface IdentitySnapshot {
  readonly id: string; readonly name: string; readonly handle: string; readonly state: string; readonly task: string;
  readonly steps: number; readonly budget: number; readonly costUsd: number; readonly error: string; readonly lastTools: readonly ToolRow[];
  readonly degraded: boolean; readonly genMs: number; readonly earlyStopRemaining: number;
  /** Estado do stream de vídeo do daemon: a UI mostra "ao vivo" por ele, não pela chegada de pacotes (tela parada não gera pacote). */
  readonly video: VideoState;
  // Incremento 5 (spec §3.1).
  readonly lifecycle: string; readonly paused: boolean; readonly controlled: boolean;
  readonly ledgerCount: number; readonly lastStepTokens: number;
  readonly appPackage: string; readonly appVersionName: string; readonly consolePort: number; readonly mcpHostPort: number;
  readonly avdName: string; readonly serial: string; readonly snapshotTakenAt: string | null; readonly restoreUnsafe: boolean;
  readonly diskBytes: number | null; readonly bannedReason: string | null; readonly discardedAt: string | null;
  readonly signals: ProbeSignalsRow | null;
  /** Há PIN registrado (o valor nunca sai do daemon). */
  readonly hasPin: boolean;
}
export type ProviderSnapshot = ProviderRow & { readonly lastTest: ProviderTest | null };

export interface GoalSummary {
  readonly id: string; readonly text: string; readonly pattern: string; readonly state: string; readonly costUsd: number;
  readonly createdAt: string; readonly finishedAt: string | null; readonly rationale: string | null;
  readonly tasksTotal: number; readonly tasksDone: number; readonly tasksFailed: number; readonly tasksNeeds: number;
  readonly tasksRunning: number; readonly itemsHandled: number;
}
/** Uma fatia da VRAM medida: cada modelo carregado, os emuladores e o resto do sistema. */
export interface GpuSlice {
  readonly kind: 'model' | 'emulators' | 'other';
  readonly label: string; readonly usedMiB: number;
  readonly runtime?: 'ollama' | 'lmstudio';
}
export interface GpuBreakdown { readonly totalMiB: number; readonly usedMiB: number; readonly slices: readonly GpuSlice[]; readonly at: string }
export interface HostMetrics {
  readonly ramUsedGiB: number; readonly ramTotalGiB: number; readonly cpuPct: number; readonly threads: number;
  readonly vramUsedMiB: number | null; readonly vramTotalMiB: number | null; readonly at: string;
  /** Ocupação da GPU por consumidor (nvidia-smi por processo + runtimes locais); null sem GPU NVIDIA. */
  readonly gpu?: GpuBreakdown | null;
}
export interface FleetSnapshot {
  readonly identities: readonly IdentitySnapshot[]; readonly providers: Readonly<Record<RoleKey, ProviderSnapshot>>;
  readonly killed: boolean; readonly updatedAt: string;
  readonly goal: GoalSummary | null; readonly host: HostMetrics | null;
}
export interface SnapshotSources {
  readonly videoState?: (id: string) => VideoState;
  readonly host?: () => HostMetrics | null;
}

const BUDGET = Number(process.env.ENXAME_STEP_BUDGET ?? 30);
const DAY_MS = 86_400_000;

/** SQLite grava `datetime('now')` sem fuso ("YYYY-MM-DD HH:MM:SS", UTC); ISO passa direto. */
export function sqliteUtcMs(at: string): number {
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(at) ? at : `${at.replace(' ', 'T')}Z`);
}

export function isRestoreUnsafe(snapshotTakenAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!snapshotTakenAt) return false;
  const t = sqliteUtcMs(snapshotTakenAt);
  return Number.isFinite(t) && now - t > CONFIG.identity.restoreUnsafeDays * DAY_MS;
}

type TaskRow = { id: string; instruction: string; state: string; cost_usd: number; degraded: number; early_stop_remaining: number | null };
type StepRow = { idx: number; tool: string | null; result_excerpt: string | null; input_tokens: number | null; output_tokens: number | null; provider: string | null };

function identitySnapshot(db: DatabaseSync, id: IdentityRow, videoState?: (id: string) => VideoState): IdentitySnapshot {
  const task = db.prepare('select id, instruction, state, cost_usd, degraded, early_stop_remaining from task where identity_id=? order by created_at desc, rowid desc limit 1').get(id.id) as TaskRow | undefined;
  const agg = task ? (db.prepare('select count(*) as n, coalesce(sum(gen_ms), 0) as g from step where task_id=?').get(task.id) as { n: number; g: number }) : { n: 0, g: 0 };
  const steps = task ? (db.prepare('select idx, tool, result_excerpt, input_tokens, output_tokens, provider from step where task_id=? order by idx desc limit 6').all(task.id) as StepRow[]) : [];
  const lastTools = steps.map((s) => ({ idx: s.idx, tool: s.tool ?? '—', excerpt: s.result_excerpt ?? '', tokens: (s.input_tokens ?? 0) + (s.output_tokens ?? 0), gate: (s.result_excerpt ?? '').startsWith('GATE'), provider: s.provider }));
  const ledger = db.prepare('select count(*) as n from ledger where identity_id=?').get(id.id) as { n: number };
  return {
    id: id.id, name: id.name, handle: id.handle, state: id.state, task: task?.instruction ?? 'Aguardando',
    steps: agg.n, budget: BUDGET, costUsd: task?.cost_usd ?? 0, error: id.lastError ?? '', lastTools,
    degraded: (task?.degraded ?? 0) === 1, genMs: agg.g, earlyStopRemaining: task?.early_stop_remaining ?? 0,
    video: videoState?.(id.id) ?? 'idle',
    lifecycle: id.state, paused: id.paused ?? false, controlled: id.controlled ?? false,
    ledgerCount: ledger.n, lastStepTokens: lastTools[0]?.tokens ?? 0,
    appPackage: id.appPackage, appVersionName: id.appVersionName, consolePort: id.consolePort, mcpHostPort: id.mcpHostPort,
    avdName: id.avdName, serial: id.serial, snapshotTakenAt: id.snapshotTakenAt ?? null, restoreUnsafe: isRestoreUnsafe(id.snapshotTakenAt),
    diskBytes: id.diskBytes ?? null, bannedReason: id.bannedReason ?? null, discardedAt: id.discardedAt ?? null,
    signals: id.lastSignals ?? null, hasPin: !!id.lockPin,
  };
}

type GoalDbRow = { id: string; text: string; pattern: string; state: string; cost_usd: number; created_at: string; finished_at: string | null; rationale: string | null };

/** Resumo de um objetivo com contagens por estado das tarefas e itens do ledger gravados por elas. */
export function goalSummary(db: DatabaseSync, g: GoalDbRow): GoalSummary {
  const counts = db.prepare(`select count(*) as total,
      coalesce(sum(state='done'), 0) as done, coalesce(sum(state='failed'), 0) as failed,
      coalesce(sum(state='needs-human'), 0) as needs, coalesce(sum(state in ('running','todo')), 0) as running
    from task where goal_id=?`).get(g.id) as { total: number; done: number; failed: number; needs: number; running: number };
  const items = db.prepare('select count(*) as n from ledger where task_id in (select id from task where goal_id=?)').get(g.id) as { n: number };
  return {
    id: g.id, text: g.text, pattern: g.pattern, state: g.state, costUsd: g.cost_usd, createdAt: g.created_at,
    finishedAt: g.finished_at ?? null, rationale: g.rationale ?? null,
    tasksTotal: counts.total, tasksDone: counts.done, tasksFailed: counts.failed, tasksNeeds: counts.needs,
    // Objetivo fechado não tem tarefa rodando: 'todo' que sobrou (kill, pausa, infra) fica para repetir num objetivo novo.
    tasksRunning: g.state === 'running' ? counts.running : 0, itemsHandled: items.n,
  };
}

const GOAL_COLS = 'id, text, pattern, state, cost_usd, created_at, finished_at, rationale';

export function listGoals(db: DatabaseSync, limit = 20): readonly GoalSummary[] {
  return (db.prepare(`select ${GOAL_COLS} from goal order by created_at desc, rowid desc limit ?`).all(limit) as GoalDbRow[]).map((g) => goalSummary(db, g));
}

export function currentGoal(db: DatabaseSync): GoalSummary | null {
  const g = db.prepare(`select ${GOAL_COLS} from goal order by created_at desc, rowid desc limit 1`).get() as GoalDbRow | undefined;
  return g ? goalSummary(db, g) : null;
}

/** Aceita a assinatura antiga (`videoState` como 3º argumento) e o objeto de fontes do incremento 5. */
export function buildSnapshot(db: DatabaseSync, killed: boolean, sources?: SnapshotSources | ((id: string) => VideoState)): FleetSnapshot {
  const src: SnapshotSources = typeof sources === 'function' ? { videoState: sources } : (sources ?? {});
  const identities = listIdentities(db).map((id) => identitySnapshot(db, id, src.videoState));
  const cfg = readProviderConfig(db); const tests = lastProviderTests(db);
  const providers = Object.fromEntries((Object.keys(cfg) as RoleKey[]).map((k) => [k, { ...cfg[k], lastTest: tests[k] ?? null }])) as Record<RoleKey, ProviderSnapshot>;
  let host: HostMetrics | null = null;
  try { host = src.host?.() ?? null; } catch { host = null; }
  return { identities, providers, killed, updatedAt: new Date().toISOString(), goal: currentGoal(db), host };
}
