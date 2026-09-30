import { generateText, Output, type LanguageModel } from 'ai';
import { z } from 'zod';
import type { MemoryRow, SubtaskRow } from '../db/missions.js';
import { LEADER_TEXTS, type Lang } from '../leader/lang.js';
import type { ProviderConfig } from '../provider/config.js';
import { buildModel as defaultBuildModel, pricingFor, structuredOutputOptions } from '../provider/factory.js';
import { createOllamaSupervisor, warnIfExternalOllama } from '../provider/ollama.js';
import { costOf, type UsageLike } from '../worker/record.js';

/** Sem min/max de propósito (mesmo motivo de LeaderOut: o Ollama descarta a gramática). Validação em `toDecision`. */
export const PlannerOut = z.object({
  decision: z.enum(['next', 'done', 'human']),
  objective: z.string(), success_criteria: z.string(), rationale: z.string(), summary: z.string(), reason: z.string(),
});
export type PlannerDecision =
  | { readonly kind: 'next'; readonly objective: string; readonly successCriteria: string; readonly rationale: string }
  | { readonly kind: 'done'; readonly summary: string }
  | { readonly kind: 'human'; readonly reason: string };
export class PlannerError extends Error {}

export interface PlannerInput {
  readonly missionText: string; readonly identity: { readonly name: string; readonly handle: string; readonly appPackage: string };
  readonly memory: readonly MemoryRow[]; readonly subtasks: readonly SubtaskRow[]; readonly screen: string; readonly lang: Lang;
  /** Instruções do operador (spec instruções), mais recentes primeiro; `loop.ts` manda até 10. */
  readonly notes: readonly string[];
  /** Arquivos guardados no Tapflock (spec arquivos), uma linha cada ("label: nome (tipo), de conta"); ausente = nenhum. */
  readonly files?: readonly string[];
}
export interface PlannerDeps {
  readonly providers: ProviderConfig; readonly apiKey?: string; readonly model?: LanguageModel; readonly generate?: typeof generateText;
  readonly buildModel?: typeof defaultBuildModel;
  readonly ollama?: { ensure(endpoint: string, model: string, runtime?: 'ollama' | 'lmstudio' | null): Promise<{ spawnedByUs?: boolean; contextWarning?: string | null }> };
}

const ATTEMPTS = 2;
const MAX = 600;
const clip = (s: string) => s.trim().slice(0, MAX);

const instructions = (lang: Lang) => `Você planeja uma MISSÃO longa executada num celular Android por um agente executor.
A cada chamada, olhe a missão, a memória, o histórico de subtarefas (com o relatório de cada uma) e a tela atual, e decida UMA coisa:
- "next": a próxima subtarefa. "objective" curto e acionável (uma etapa verificável, não a missão inteira); "success_criteria" diz como saber que deu certo; "rationale" em uma frase.
- "done": a missão está cumprida, com evidência na memória ou na tela. "summary" em uma ou duas frases.
- "human": só um humano resolve (captcha, verificação por telefone/SMS, "confirme que é você"), ou todos os caminhos razoáveis já falharam por isso. "reason" diz o que o humano precisa fazer.
Arquivos: o executor tem file_export (guarda no Tapflock um arquivo baixado neste celular, para outra conta) e file_import (copia para este celular um arquivo guardado). Quando a missão precisa de um arquivo da lista, planeje uma subtarefa que o importe antes de usá-lo; quando outra conta vai usar um arquivo desta missão, planeje baixá-lo e exportá-lo com o label pedido. O executor também tem screen_capture: captura a tela, ou só um nó pelos bounds, direto para a galeria do celular. Use quando não há como baixar (ex.: repostar o post de outra pessoa: abrir o post, capturar a imagem, postar da galeria). Nunca planeje pedir à pessoa um print ou botões físicos.
Regras: se uma subtarefa falhou, não repita o mesmo caminho do mesmo jeito — escolha outro (outro provedor, outro app, outra rota). Não proponha de novo o mesmo objetivo, site ou provedor de uma subtarefa que falhou (veja "Rotas que já falharam"), a menos que o relatório dela mostre que o bloqueio foi resolvido. Depois de uma falha, mude de rota (outro provedor, outro app, outro caminho) ou decida "human". Subtarefa "interrupted" foi cortada no meio: confira a tela antes de repetir. Nunca proponha contornar captcha ou verificação. Instruções do operador têm prioridade sobre o seu plano, exceto para contornar verificação humana.
Escreva objective, success_criteria, rationale, summary e reason em ${LEADER_TEXTS[lang].promptName}. Campos que não se aplicam: "".`;

export function plannerPrompt(i: PlannerInput): string {
  const mem = i.memory.length ? i.memory.map((m) => `- ${m.key}: ${m.secret ? '(segredo)' : m.value}`).join('\n') : '(vazia)';
  const hist = i.subtasks.length
    ? i.subtasks.map((s) => `#${s.seq} [${s.state}] ${s.objective}${s.report ? ` — ok=${s.report.ok}; fez: ${s.report.did}; atrapalhou: ${s.report.blockers || '-'}` : ''}`).join('\n')
    : '(nenhuma ainda)';
  // Objetivos das subtarefas failed (spec missões §Planejador): o planejador não deve propor a mesma rota de novo.
  const failedRoutes = i.subtasks.filter((s) => s.state === 'failed').map((s) => s.objective);
  const routes = failedRoutes.length ? failedRoutes.join('; ') : '(nenhuma)';
  // Instruções do operador (spec instruções): mais recentes primeiro, como `loop.ts` manda.
  const notes = i.notes.length ? i.notes.map((n) => `- ${n}`).join('\n') : '(nenhuma)';
  const files = i.files?.length ? i.files.map((f) => `- ${f}`).join('\n') : '(nenhum)';
  return `Missão: ${i.missionText}\nInstruções do operador (siga-as antes do seu próprio plano; mais recentes primeiro):\n${notes}\nIdentidade: ${i.identity.name} (${i.identity.handle}), app alvo ${i.identity.appPackage}\nMemória:\n${mem}\nArquivos guardados no Tapflock (o executor copia com file_import):\n${files}\nSubtarefas:\n${hist}\nRotas que já falharam: ${routes}\nTela atual:\n${i.screen}`;
}

function toDecision(o: z.infer<typeof PlannerOut>): PlannerDecision {
  if (o.decision === 'next') {
    const objective = clip(o.objective);
    if (!objective) throw new PlannerError('planejador pediu next sem objetivo');
    return { kind: 'next', objective, successCriteria: clip(o.success_criteria) || objective, rationale: clip(o.rationale) };
  }
  if (o.decision === 'done') return { kind: 'done', summary: clip(o.summary) || 'missão concluída' };
  const reason = clip(o.reason);
  if (!reason) throw new PlannerError('planejador pediu humano sem motivo');
  return { kind: 'human', reason };
}

/** Uma decisão do planejador (papel `lider`); 2 tentativas, depois PlannerError (a missão pausa — spec missões §Loop). */
export async function planNext(input: PlannerInput, d: PlannerDeps): Promise<{ decision: PlannerDecision; costUsd: number }> {
  const row = d.providers.lider;
  if (row.mode === 'local' && !d.model) warnIfExternalOllama(await (d.ollama ?? createOllamaSupervisor()).ensure(row.endpoint, row.model, row.runtime));
  const model = d.model ?? (d.buildModel ?? defaultBuildModel)(row, { anthropicApiKey: d.apiKey });
  let costUsd = 0; let last: unknown = null;
  for (let k = 1; k <= ATTEMPTS; k++) {
    try {
      const res = await (d.generate ?? generateText)({ model, instructions: instructions(input.lang), prompt: plannerPrompt(input), output: Output.object({ schema: PlannerOut, name: 'decisao' }), providerOptions: structuredOutputOptions(row) as never });
      costUsd += costOf((res.totalUsage ?? res.usage) as UsageLike, pricingFor(row));
      return { decision: toDecision(res.output), costUsd };
    } catch (e) { last = e; }
  }
  throw last instanceof PlannerError ? last : new PlannerError(String((last as Error)?.message ?? last).slice(0, 300));
}
