import type { SubtaskReport, SubtaskState } from '../db/missions.js';

type Outcome = 'done' | 'budget' | 'killed' | 'interrupted' | 'platform-block' | 'infra' | 'failed' | 'quality-floor';

/**
 * Desfecho do executor → estado da subtarefa (spec missões §Erros). Humano vence tudo; kill/pausa/infra interrompem
 * (a missão pausa e o planejador decide depois); sem finish_subtask a subtarefa falha com o motivo.
 */
export function missionOutcome(i: { outcome: Outcome; report: SubtaskReport | null; halt: { kind: string; text: string } | null; summary: string; budgetHit: boolean }):
  { state: SubtaskState; report: SubtaskReport | null; humanReason: string | null } {
  if (i.halt?.kind === 'platform-block') return { state: 'needs-human', report: { ok: false, did: i.summary.slice(0, 600), blockers: i.halt.text }, humanReason: i.halt.text };
  if (i.outcome === 'killed' || i.outcome === 'interrupted' || i.outcome === 'infra') return { state: 'interrupted', report: null, humanReason: null };
  if (i.report) return { state: i.report.ok ? 'done' : 'failed', report: i.report, humanReason: null };
  if (i.outcome === 'failed' || i.outcome === 'quality-floor') return { state: 'failed', report: { ok: false, did: '', blockers: i.summary.slice(0, 600) }, humanReason: null };
  const blockers = i.budgetHit ? 'orçamento de passos da subtarefa esgotado' : 'terminou sem finish_subtask';
  return { state: 'failed', report: { ok: false, did: i.summary.slice(0, 600), blockers }, humanReason: null };
}
