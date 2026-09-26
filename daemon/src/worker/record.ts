import type { DatabaseSync } from 'node:sqlite';
import { addTaskCost, finishStep, writeIntent } from '../db/tasks.js';

export interface Pricing { readonly inputPerM: number; readonly outputPerM: number; readonly cacheReadPerM: number }
/** Preços por milhão de tokens. CONFIRMAR na tabela oficial antes de usar em relatório; o relatório também imprime tokens crus. */
export const HAIKU_PRICING: Pricing = { inputPerM: 1, outputPerM: 5, cacheReadPerM: 0.1 };

export interface UsageLike {
  readonly inputTokens?: number; readonly outputTokens?: number;
  readonly inputTokenDetails?: { readonly cacheReadTokens?: number };
  readonly cachedInputTokens?: number;
}
export interface StepLike {
  readonly stepNumber: number; readonly text: string;
  readonly toolCalls: readonly { toolCallId: string; toolName: string; input: unknown }[];
  readonly toolResults: readonly { toolCallId: string; toolName: string; output: { type: string; value?: unknown; reason?: string } }[];
  readonly usage: UsageLike;
}

export function readUsage(u: UsageLike): { inputTokens: number; outputTokens: number; cacheReadTokens: number } {
  return { inputTokens: u.inputTokens ?? 0, outputTokens: u.outputTokens ?? 0, cacheReadTokens: u.inputTokenDetails?.cacheReadTokens ?? u.cachedInputTokens ?? 0 };
}

export function costOf(u: UsageLike, p: Pricing): number {
  const { inputTokens, outputTokens, cacheReadTokens } = readUsage(u);
  return ((inputTokens - cacheReadTokens) * p.inputPerM + cacheReadTokens * p.cacheReadPerM + outputTokens * p.outputPerM) / 1_000_000;
}

function excerptOf(out: { type: string; value?: unknown; reason?: string }): { excerpt: string; error: string | null } {
  if (out.type === 'execution-denied') return { excerpt: `GATE ${out.reason ?? ''}`.trim(), error: null };
  const v = out.value;
  const s = (typeof v === 'string' ? v : JSON.stringify(v) ?? '').replace(/\s+/g, ' ');
  if (out.type === 'error-text' || out.type === 'error-json') return { excerpt: `ERRO ${s}`.slice(0, 300), error: s.slice(0, 500) };
  return { excerpt: s.slice(0, 300), error: null };
}

/** Um passo do modelo pode ter 0..n tool calls; cada uma vira uma linha de step com a mesma usage rateada no primeiro. */
export function recordStep(db: DatabaseSync, taskId: string, step: StepLike, pricing: Pricing): { costUsd: number } {
  const usage = readUsage(step.usage);
  const costUsd = costOf(step.usage, pricing);
  const calls = step.toolCalls.length ? step.toolCalls : [{ toolCallId: `s${step.stepNumber}`, toolName: '(texto)', input: null }];
  calls.forEach((c, i) => {
    const id = writeIntent(db, taskId, step.stepNumber * 100 + i, c.toolName, c.input, `${taskId}:${step.stepNumber}:${c.toolCallId}`);
    const res = step.toolResults.find((r) => r.toolCallId === c.toolCallId);
    const ex = res ? excerptOf(res.output) : { excerpt: step.text.slice(0, 300), error: null };
    finishStep(db, id, {
      resultExcerpt: ex.excerpt, error: ex.error ?? undefined,
      inputTokens: i === 0 ? usage.inputTokens : 0, outputTokens: i === 0 ? usage.outputTokens : 0, cacheReadTokens: i === 0 ? usage.cacheReadTokens : 0,
    });
  });
  addTaskCost(db, taskId, costUsd);
  return { costUsd };
}
