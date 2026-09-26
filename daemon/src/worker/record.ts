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
/** Partes de `StepResult.content` que interessam ao registro (shape do ai@7: output/error crus, negação como parte própria). */
export interface ToolCallPart { readonly type: 'tool-call'; readonly toolCallId: string; readonly toolName: string; readonly input?: unknown }
export interface ToolResultPart { readonly type: 'tool-result'; readonly toolCallId: string; readonly toolName: string; readonly input?: unknown; readonly output: unknown }
export interface ToolErrorPart { readonly type: 'tool-error'; readonly toolCallId: string; readonly toolName: string; readonly input?: unknown; readonly error: unknown }
export interface ToolDeniedPart { readonly type: 'tool-output-denied'; readonly toolCallId: string; readonly toolName: string }
/** Forma real da negação pelo `toolApproval` no ai@7 (observada): request + response com `approved:false` no mesmo passo. */
export interface ToolApprovalResponsePart {
  readonly type: 'tool-approval-response'; readonly approvalId: string; readonly approved: boolean;
  readonly toolCall: { readonly toolCallId: string; readonly toolName: string; readonly input?: unknown };
}
/** O conteúdo real tem outras partes (text, reasoning, approval-request…); só o `type` é garantido. */
export type StepPart = { readonly type: string };
export interface StepLike {
  readonly stepNumber: number; readonly text: string; readonly content: readonly StepPart[]; readonly usage: UsageLike;
}

export function readUsage(u: UsageLike): { inputTokens: number; outputTokens: number; cacheReadTokens: number } {
  return { inputTokens: u.inputTokens ?? 0, outputTokens: u.outputTokens ?? 0, cacheReadTokens: u.inputTokenDetails?.cacheReadTokens ?? u.cachedInputTokens ?? 0 };
}

export function costOf(u: UsageLike, p: Pricing): number {
  const { inputTokens, outputTokens, cacheReadTokens } = readUsage(u);
  return ((inputTokens - cacheReadTokens) * p.inputPerM + cacheReadTokens * p.cacheReadPerM + outputTokens * p.outputPerM) / 1_000_000;
}

/** Texto de um resultado de tool MCP (`{content:[{type:'text',text}]}`), de uma string, ou JSON do resto. */
export function textOf(result: unknown): string {
  if (typeof result === 'string') return result;
  const r = result as { content?: { type: string; text?: string }[] } | null;
  if (r && Array.isArray(r.content)) return r.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n');
  return JSON.stringify(result) ?? '';
}

const errText = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}` : typeof e === 'string' ? e : JSON.stringify(e) ?? String(e));
const squash = (s: string, n: number) => s.replace(/\s+/g, ' ').slice(0, n);

const GATE_EXCERPT = 'GATE negou a execução (gate determinístico, modo somente-leitura)';

interface CallRow { toolName: string; input: unknown; excerpt: string; error: string | null }

/** Agrupa as partes por toolCallId: a chamada define nome/input; resultado, erro ou negação definem excerpt/error. */
function rowsFromContent(step: StepLike): readonly (CallRow & { id: string })[] {
  const rows = new Map<string, CallRow>();
  const ensure = (id: string, name: string, input: unknown) => {
    const r = rows.get(id) ?? { toolName: name, input, excerpt: '', error: null }; rows.set(id, r); return r;
  };
  for (const part of step.content) {
    switch (part.type) {
      case 'tool-call': { const p = part as ToolCallPart; ensure(p.toolCallId, p.toolName, p.input); break; }
      case 'tool-result': { const p = part as ToolResultPart; ensure(p.toolCallId, p.toolName, p.input).excerpt = squash(textOf(p.output), 300); break; }
      case 'tool-error': { const p = part as ToolErrorPart; const r = ensure(p.toolCallId, p.toolName, p.input); r.error = squash(errText(p.error), 500); r.excerpt = squash(`ERRO ${r.error}`, 300); break; }
      case 'tool-output-denied': { const p = part as ToolDeniedPart; ensure(p.toolCallId, p.toolName, undefined).excerpt = GATE_EXCERPT; break; }
      case 'tool-approval-response': { const p = part as ToolApprovalResponsePart; if (!p.approved) ensure(p.toolCall.toolCallId, p.toolCall.toolName, p.toolCall.input).excerpt = GATE_EXCERPT; break; }
      default: break;
    }
  }
  return [...rows.entries()].map(([id, r]) => ({ id, ...r }));
}

/**
 * Um passo do modelo pode ter 0..n tool calls. Chamadas que executaram já têm linha (write-ahead em `wrapTools`,
 * em `pending` por toolCallId) e são apenas completadas; alucinadas/negadas nunca executaram e ganham linha aqui.
 * A usage do passo vai na primeira linha.
 */
export function recordStep(db: DatabaseSync, taskId: string, step: StepLike, pricing: Pricing, pending: Map<string, number> = new Map()): { costUsd: number } {
  const usage = readUsage(step.usage);
  const costUsd = costOf(step.usage, pricing);
  const rows = rowsFromContent(step);
  const calls = rows.length ? rows : [{ id: `s${step.stepNumber}`, toolName: '(texto)', input: null, excerpt: squash(step.text, 300), error: null }];
  calls.forEach((c, i) => {
    const existing = pending.get(c.id);
    const id = existing ?? writeIntent(db, taskId, c.toolName, c.input, `${taskId}:${step.stepNumber}:${c.id}`);
    if (existing !== undefined) pending.delete(c.id);
    finishStep(db, id, {
      resultExcerpt: c.excerpt, error: c.error ?? undefined,
      inputTokens: i === 0 ? usage.inputTokens : 0, outputTokens: i === 0 ? usage.outputTokens : 0, cacheReadTokens: i === 0 ? usage.cacheReadTokens : 0,
    });
  });
  addTaskCost(db, taskId, costUsd);
  return { costUsd };
}
