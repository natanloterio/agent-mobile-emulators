import { generateText, Output, type LanguageModel } from 'ai';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { CONFIG } from '../config.js';
import type { IdentityRow } from '../db/identities.js';
import { readProviderConfig, type ProviderConfig } from '../provider/config.js';
import { buildModel as defaultBuildModel, pricingFor, structuredOutputOptions } from '../provider/factory.js';
import { createOllamaSupervisor } from '../provider/ollama.js';
import { costOf, type UsageLike } from '../worker/record.js';
import { DEFAULT_LANG, LEADER_TEXTS, sliceInstruction, type Lang } from './lang.js';
import { candidateIdentities, probeFleet, type EnsureReady, type Readiness } from './readiness.js';
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
  readonly ollama?: { ensure(endpoint: string, model: string, runtime?: 'ollama' | 'lmstudio' | null): Promise<unknown> };
  readonly stepBudget?: number; readonly staggerMs?: number;
}

interface Decision { readonly pattern: Pattern; readonly rationale: string; readonly instructions: ReadonlyMap<string, string> }

/** Regra do spec §4.3 quando não há LLM: lista/fila de itens → sharding; trabalho preso à conta → fan-out. */
const SHARDING_HINT = /fila|lista|\bmenções\b|\d+\s+(itens|menções|perfis)/i;

/** Justificativa e fatias saem em `lang` (tabela em lang.ts); o texto do objetivo fica como o usuário escreveu. */
export function deterministicPlan(text: string, readyIds: readonly string[], lang: Lang = DEFAULT_LANG): Decision {
  const texts = LEADER_TEXTS[lang];
  if (!SHARDING_HINT.test(text)) {
    return { pattern: 'fan-out', rationale: texts.fanOut, instructions: new Map(readyIds.map((id) => [id, text])) };
  }
  const n = readyIds.length;
  const slice = (k: number) => (n <= 1 ? text : `${text}\n${sliceInstruction(lang, k, n)}`);
  return { pattern: 'sharding', rationale: texts.sharding, instructions: new Map(readyIds.map((id, k) => [id, slice(k)])) };
}

/**
 * Sem minLength/maxLength de propósito: o Ollama (0.30) descarta a gramática inteira de um json_schema que os tenha e o
 * modelo local responde texto livre (medido com gpt-oss:20b). Os limites são aplicados depois, em `clampDecision`.
 */
export const LeaderOut = z.object({
  pattern: z.enum(['fan-out', 'sharding']),
  rationale: z.string(),
  instructions: z.array(z.object({ identityId: z.string(), instruction: z.string() })),
});
const LOCAL_ATTEMPTS = 2;
const MAX_RATIONALE = 600; const MAX_INSTRUCTION = 2000;

const leaderInstructions = (lang: Lang) => `Você é o líder de um enxame de celulares Android, cada um logado numa conta diferente do mesmo app.
Decomponha o objetivo do usuário em uma instrução por identidade e escolha o padrão:
- "fan-out" quando o trabalho pertence à conta (ex.: cada conta responde os comentários da própria caixa): cada identidade recebe a mesma tarefa sobre a própria conta.
- "sharding" quando há uma fila de itens compartilhada (lista de perfis, menções, itens numerados): divida a fila entre as identidades prontas e descreva na instrução de cada uma exatamente a sua fatia.
Responda com "pattern", "rationale" (uma ou duas frases curtas em ${LEADER_TEXTS[lang].promptName}) e "instructions" (uma por identidade da lista, em ${LEADER_TEXTS[lang].promptName}, curta e acionável).
As ações continuam somente-leitura: nada de enviar, publicar ou seguir.`;

function leaderPrompt(text: string, fleet: readonly Readiness[]): string {
  const ids = fleet.map((r) => ({ identityId: r.identity.id, nome: r.identity.name, handle: r.identity.handle, estado: r.identity.state, pronta: r.ready }));
  return `Objetivo: ${text}\nIdentidades (JSON): ${JSON.stringify(ids)}`;
}

async function llmDecision(text: string, fleet: readonly Readiness[], cfg: ProviderConfig, d: PlanDeps, lang: Lang): Promise<{ decision: Decision; costUsd: number }> {
  const row = cfg.lider;
  // Papel local: o Ollama tem de estar de pé antes da chamada, como no worker (run.ts).
  if (row.mode === 'local') await (d.ollama ?? createOllamaSupervisor()).ensure(row.endpoint, row.model, row.runtime);
  const model = d.model ?? (d.buildModel ?? defaultBuildModel)(row, { anthropicApiKey: d.apiKey });
  const call = () => (d.generate ?? generateText)({ model, instructions: leaderInstructions(lang), prompt: leaderPrompt(text, fleet), output: Output.object({ schema: LeaderOut, name: 'plano' }), providerOptions: structuredOutputOptions(row) as never });
  // Modelo local às vezes escapa da gramática e responde prosa (gpt-oss:20b, ~1 em 3 medido): uma nova tentativa antes da regra.
  const attempts = row.mode === 'local' ? LOCAL_ATTEMPTS : 1;
  let res!: Awaited<ReturnType<typeof call>>;
  for (let k = 1; ; k++) {
    try { res = await call(); break; } catch (e) { if (k >= attempts) throw e; }
  }
  const out = res.output;
  const known = new Set(fleet.map((r) => r.identity.id));
  const instructions = new Map(out.instructions
    .map((i) => [i.identityId, i.instruction.trim().slice(0, MAX_INSTRUCTION)] as const)
    .filter(([id, instr]) => known.has(id) && instr.length > 0));
  const rationale = out.rationale.trim().slice(0, MAX_RATIONALE);
  if (!rationale) throw new Error('líder respondeu sem justificativa');
  const usage = (res.totalUsage ?? res.usage) as UsageLike;
  return { decision: { pattern: out.pattern, rationale, instructions }, costUsd: costOf(usage, pricingFor(row)) };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Nome ou @ citado como palavra inteira ("papaia" não casa "papaia.me"; "conta1" não casa "conta10"). */
const cites = (text: string, word: string) => !!word && new RegExp(`(^|[^\\w.@])@?${escapeRe(word)}(?![\\w.])`, 'i').test(text);

/** Identidades que o objetivo cita pelo nome (`conta2`) ou pelo @ da conta (`@papaia`). */
export function mentionedIdentities(text: string, ids: readonly IdentityRow[]): readonly IdentityRow[] {
  return ids.filter((i) => cites(text, i.name) || cites(text, i.handle.replace(/^@/, '')));
}

/**
 * Líder (spec §4.3, inc. 5 §3.3): sonda a frota, decide fan-out × sharding e a instrução de cada identidade.
 * Sem chave (papel na nuvem) ou erro do modelo: regra determinística e o erro vai em `leader.error`. Nunca lança por causa do modelo.
 * `lang`: idioma da justificativa e das instruções (o da interface); sem ele, português.
 */
export async function planGoal(text: string, d: PlanDeps, lang: Lang = DEFAULT_LANG): Promise<GoalPlan> {
  const cfg = d.providers ?? readProviderConfig(d.db);
  // Objetivo que cita identidades (nome ou @) vale só para elas: regra fixa, vale mesmo quando o modelo erra a atribuição.
  const cited = mentionedIdentities(text, candidateIdentities(d.db));
  const only = cited.length ? new Set(cited.map((i) => i.id)) : undefined;
  const fleet = await probeFleet(d.db, d.ensureReady, only);
  const targeted = only ? fleet.filter((r) => only.has(r.identity.id)) : fleet;
  const readyIds = fleet.filter((r) => r.ready).map((r) => r.identity.id);
  let decision: Decision; let costUsd = 0; let error: string | null = null;
  try { ({ decision, costUsd } = await llmDecision(text, targeted, cfg, d, lang)); }
  catch (e) { error = String((e as Error)?.message ?? e).slice(0, 300); decision = deterministicPlan(text, readyIds, lang); }
  const tasks = fleet.map((r) => ({
    identityId: r.identity.id, name: r.identity.name, handle: r.identity.handle,
    instruction: (!only || only.has(r.identity.id) ? decision.instructions.get(r.identity.id) : undefined) || text, signals: r.signals, ready: r.ready, readyLabel: r.readyLabel,
  }));
  // Na estimativa, `0` significa "sem limite" (CONFIG.worker.stepBudget vira null quando ENXAME_STEP_BUDGET=0).
  const stepBudget = d.stepBudget ?? CONFIG.worker.stepBudget ?? 0;
  const staggerMs = d.staggerMs ?? CONFIG.swarm.staggerMs;
  return {
    text, pattern: decision.pattern, rationale: decision.rationale, tasks,
    estimate: { tasks: readyIds.length, outOfProbe: fleet.length - readyIds.length, stepBudget, fleetReadyMs: readyIds.length * staggerMs },
    leader: { model: cfg.lider.model, costUsd, error },
  };
}
