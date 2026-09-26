import type { DatabaseSync } from 'node:sqlite';
import { listIdentities } from '../db/identities.js';
import { readProviderConfig, type ProviderRow, type RoleKey } from '../provider/config.js';
import { lastProviderTests, type ProviderTest } from '../provider/probe.js';

export interface ToolRow { readonly idx: number; readonly tool: string; readonly excerpt: string; readonly tokens: number; readonly gate: boolean; readonly provider: string | null }
export interface IdentitySnapshot {
  readonly id: string; readonly name: string; readonly handle: string; readonly state: string; readonly task: string;
  readonly steps: number; readonly budget: number; readonly costUsd: number; readonly error: string; readonly lastTools: readonly ToolRow[];
  readonly degraded: boolean; readonly genMs: number;
}
export type ProviderSnapshot = ProviderRow & { readonly lastTest: ProviderTest | null };
export interface FleetSnapshot {
  readonly identities: readonly IdentitySnapshot[]; readonly providers: Readonly<Record<RoleKey, ProviderSnapshot>>;
  readonly killed: boolean; readonly updatedAt: string;
}

const BUDGET = Number(process.env.ENXAME_STEP_BUDGET ?? 30);

export function buildSnapshot(db: DatabaseSync, killed: boolean): FleetSnapshot {
  const identities = listIdentities(db).map((id) => {
    const task = db.prepare('select id, instruction, state, cost_usd, degraded from task where identity_id=? order by created_at desc limit 1').get(id.id) as
      { id: string; instruction: string; state: string; cost_usd: number; degraded: number } | undefined;
    const agg = task ? (db.prepare('select count(*) as n, coalesce(sum(gen_ms), 0) as g from step where task_id=?').get(task.id) as { n: number; g: number }) : { n: 0, g: 0 };
    const lastTools = task ? (db.prepare('select idx, tool, result_excerpt, input_tokens, output_tokens, provider from step where task_id=? order by idx desc limit 6').all(task.id) as
      { idx: number; tool: string | null; result_excerpt: string | null; input_tokens: number | null; output_tokens: number | null; provider: string | null }[])
      .map((s) => ({ idx: s.idx, tool: s.tool ?? '—', excerpt: s.result_excerpt ?? '', tokens: (s.input_tokens ?? 0) + (s.output_tokens ?? 0), gate: (s.result_excerpt ?? '').startsWith('GATE'), provider: s.provider })) : [];
    return {
      id: id.id, name: id.name, handle: id.handle, state: id.state, task: task?.instruction ?? 'Aguardando',
      steps: agg.n, budget: BUDGET, costUsd: task?.cost_usd ?? 0, error: id.lastError ?? '', lastTools,
      degraded: (task?.degraded ?? 0) === 1, genMs: agg.g,
    };
  });
  const cfg = readProviderConfig(db); const tests = lastProviderTests(db);
  const providers = Object.fromEntries((Object.keys(cfg) as RoleKey[]).map((k) => [k, { ...cfg[k], lastTest: tests[k] ?? null }])) as Record<RoleKey, ProviderSnapshot>;
  return { identities, providers, killed, updatedAt: new Date().toISOString() };
}
