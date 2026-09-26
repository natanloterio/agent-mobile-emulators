import { generateText, Output, type LanguageModel } from 'ai';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { CONFIG } from '../config.js';
import { readProviderConfig, type ProviderConfig } from '../provider/config.js';
import { buildModel as defaultBuildModel, pricingFor } from '../provider/factory.js';
import { createOllamaSupervisor } from '../provider/ollama.js';
import { costOf, type UsageLike } from '../worker/record.js';
import { probeFleet, type EnsureReady, type Readiness } from './readiness.js';
import type { GoalPlan, Pattern } from './types.js';

/** Dependências do líder; tudo que toca rede ou device é injetável. */
export interface PlanDeps {
  readonly db: DatabaseSync;
  readonly ensureReady: EnsureReady;
  readonly apiKey?: string;
  readonly providers?: ProviderConfig;
  readonly generate?: typeof generateText;
  readonly model?: LanguageModel;
  readonly buildModel?: typeof defaultBuildModel;
  readonly ollama?: { ensure(endpoint: string, model: string): Promise<unknown> };
  readonly stepBudget?: number; readonly staggerMs?: number;
}

interface Decision { readonly pattern: Pattern; readonly rationale: string; readonly instructions: ReadonlyMap<string, string> }

/** Regra do spec §4.3 quando não há LLM: lista/fila de itens → sharding; trabalho preso à conta → fan-out. */
const SHARDING_HINT = /fila|lista|\bmenções\b|\d+\s+(itens|menções|perfis)/i;

export function deterministicPlan(text: string, readyIds: readonly string[]): Decision {
  if (!SHARDING_HINT.test(text)) {
    return { pattern: 'fan-out', rationale: 'Regra determinística: o trabalho pertence a cada conta → fan-out, uma tarefa por identidade.', instructions: new Map(readyIds.map((id) => [id, text])) };
  }
  const n = readyIds.length;
  const slice = (k: number) => (n <= 1 ? text
    : `${text}\nSua fatia ${k + 1} de ${n}: trate só os itens nas posições ${k + 1}, ${k + 1 + n}, ${k + 1 + 2 * n}… da fila (contando a partir de 1).`);
  return { pattern: 'sharding', rationale: 'Regra determinística: fila de itens compartilhada → sharding, uma fatia por identidade pronta.', instructions: new Map(readyIds.map((id, k) => [id, slice(k)])) };
}

const LeaderOut = z.object({
  pattern: z.enum(['fan-out', 'sharding']),
  rationale: z.string().min(1).max(600),
  instructions: z.array(z.object({ identityId: z.string(), instruction: z.string().min(1).max(2000) })),
});

const LEADER_PROMPT = `Você é o líder de um enxame de celulares Android, cada um logado numa conta diferente do mesmo app.
Decomponha o objetivo do usuário em uma instrução por identidade e escolha o padrão:
- "fan-out" quando o trabalho pertence à conta (ex.: cada conta responde os comentários da própria caixa): cada identidade recebe a mesma tarefa sobre a própria conta.
- "sharding" quando há uma fila de itens compartilhada (lista de perfis, menções, itens numerados): divida a fila entre as identidades prontas e descreva na instrução de cada uma exatamente a sua fatia.
Responda com "pattern", "rationale" (uma ou duas frases curtas em português) e "instructions" (uma por identidade da lista, em português, curta e acionável).
As ações continuam somente-leitura: nada de enviar, publicar ou seguir.`;

function leaderPrompt(text: string, fleet: readonly Readiness[]): string {
  const ids = fleet.map((r) => ({ identityId: r.identity.id, nome: r.identity.name, handle: r.identity.handle, estado: r.identity.state, pronta: r.ready }));
  return `Objetivo: ${text}\nIdentidades (JSON): ${JSON.stringify(ids)}`;
}

async function llmDecision(text: string, fleet: readonly Readiness[], cfg: ProviderConfig, d: PlanDeps): Promise<{ decision: Decision; costUsd: number }> {
  const row = cfg.lider;
  // Papel local: o Ollama tem de estar de pé antes da chamada, como no worker (run.ts).
  if (row.mode === 'local') await (d.ollama ?? createOllamaSupervisor()).ensure(row.endpoint, row.model);
  const model = d.model ?? (d.buildModel ?? defaultBuildModel)(row, { anthropicApiKey: d.apiKey });
  const res = await (d.generate ?? generateText)({ model, instructions: LEADER_PROMPT, prompt: leaderPrompt(text, fleet), output: Output.object({ schema: LeaderOut, name: 'plano' }) });
  const out = res.output;
  const known = new Set(fleet.map((r) => r.identity.id));
  const instructions = new Map(out.instructions.filter((i) => known.has(i.identityId)).map((i) => [i.identityId, i.instruction.trim()] as const));
  const usage = (res.totalUsage ?? res.usage) as UsageLike;
  return { decision: { pattern: out.pattern, rationale: out.rationale.trim(), instructions }, costUsd: costOf(usage, pricingFor(row)) };
}

/**
 * Líder (spec §4.3, inc. 5 §3.3): sonda a frota, decide fan-out × sharding e a instrução de cada identidade.
 * Sem chave (papel na nuvem) ou erro do modelo: regra determinística e o erro vai em `leader.error`. Nunca lança por causa do modelo.
 */
export async function planGoal(text: string, d: PlanDeps): Promise<GoalPlan> {
  const cfg = d.providers ?? readProviderConfig(d.db);
  const fleet = await probeFleet(d.db, d.ensureReady);
  const readyIds = fleet.filter((r) => r.ready).map((r) => r.identity.id);
  let decision: Decision; let costUsd = 0; let error: string | null = null;
  try { ({ decision, costUsd } = await llmDecision(text, fleet, cfg, d)); }
  catch (e) { error = String((e as Error)?.message ?? e).slice(0, 300); decision = deterministicPlan(text, readyIds); }
  const tasks = fleet.map((r) => ({
    identityId: r.identity.id, name: r.identity.name, handle: r.identity.handle,
    instruction: decision.instructions.get(r.identity.id) || text, signals: r.signals, ready: r.ready, readyLabel: r.readyLabel,
  }));
  const stepBudget = d.stepBudget ?? Number(process.env.ENXAME_STEP_BUDGET ?? CONFIG.worker.stepBudget);
  const staggerMs = d.staggerMs ?? CONFIG.swarm.staggerMs;
  return {
    text, pattern: decision.pattern, rationale: decision.rationale, tasks,
    estimate: { tasks: readyIds.length, outOfProbe: fleet.length - readyIds.length, stepBudget, fleetReadyMs: readyIds.length * staggerMs },
    leader: { model: cfg.lider.model, costUsd, error },
  };
}
