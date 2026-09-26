import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText, stepCountIs, tool, type ModelMessage, type StopCondition, type Tool, type ToolSet } from 'ai';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { CONFIG } from '../config.js';
import { setIdentityState, type IdentityRow } from '../db/identities.js';
import { createGoalAndTask, ledgerHas, ledgerPut, setTaskState } from '../db/tasks.js';
import { connectMcp } from '../device/mcp.js';
import { detectPlatformBlock } from '../screen/checks.js';
import { parseScreen, type ScreenState } from '../screen/parse.js';
import { buildToolApproval } from './gate.js';
import { SYSTEM_PROMPT, taskInstruction } from './prompt.js';
import { isScreenTool, pruneScreens } from './prune.js';
import { HAIKU_PRICING, readUsage, recordStep, type StepLike } from './record.js';
import { pickWorkerTools } from './tools.js';

export interface RunTaskOpts {
  readonly db: DatabaseSync; readonly identity: IdentityRow; readonly goalText: string; readonly apiKey: string;
  readonly isKilled: () => boolean; readonly onStep: () => void; readonly stepBudget?: number;
}
export interface RunTaskResult {
  readonly taskId: string; readonly outcome: 'done' | 'budget' | 'killed' | 'platform-block' | 'infra' | 'failed';
  readonly costUsd: number; readonly usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
  readonly platformBlock: string | null; readonly summary: string;
}
/** Dependências injetáveis para teste: conexão MCP e a função de geração. */
export interface RunTaskDeps {
  readonly connect: (url: string, token: string) => Promise<{ tools(): Promise<ToolSet>; close(): Promise<void> }>;
  readonly generate: typeof generateText;
}

type Halt = { kind: 'platform-block'; text: string } | { kind: 'infra'; text: string } | null;

function textOf(result: unknown): string {
  if (typeof result === 'string') return result;
  const r = result as { content?: { type: string; text?: string }[] };
  return r?.content?.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n') ?? JSON.stringify(result);
}

function classify(e: unknown): Halt {
  const msg = String((e as Error)?.message ?? e);
  if (/401|unauthorized|not found|offline|ECONNREFUSED|fetch failed/i.test(msg)) return { kind: 'infra', text: msg.slice(0, 200) };
  return null;
}

/** Envolve cada tool do MCP para ler telas, detectar bloqueio e classificar falhas de infra. */
function wrapTools(tools: ToolSet, onScreen: (s: ScreenState) => void, onHalt: (h: Halt) => void): ToolSet {
  return Object.fromEntries(Object.entries(tools).map(([name, t]) => {
    const base = t as Tool & { execute?: (input: unknown, opts: unknown) => Promise<unknown> };
    const execute = async (input: unknown, opts: unknown) => {
      try {
        const out = await base.execute!(input, opts);
        if (isScreenTool(name)) onScreen(parseScreen(textOf(out)));
        return out;
      } catch (e) { const h = classify(e); if (h) onHalt(h); throw e; }
    };
    return [name, { ...base, execute } as Tool];
  }));
}

export async function runTask(o: RunTaskOpts, deps: RunTaskDeps = { connect: connectMcp, generate: generateText }): Promise<RunTaskResult> {
  const { db, identity } = o;
  const budget = o.stepBudget ?? Number(process.env.ENXAME_STEP_BUDGET ?? CONFIG.worker.stepBudget);
  const { taskId } = createGoalAndTask(db, identity.id, o.goalText);
  setIdentityState(db, identity.id, 'running', { lastError: null });

  let lastScreen: ScreenState | null = null; let halt: Halt = null; let costUsd = 0;
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  const finish = (outcome: RunTaskResult['outcome'], summary: string): RunTaskResult => {
    const idState = outcome === 'platform-block' ? 'needs-human' : outcome === 'infra' ? 'offline' : 'idle';
    setIdentityState(db, identity.id, idState, { lastError: halt?.text ?? (outcome === 'failed' ? summary.slice(0, 200) : null) });
    setTaskState(db, taskId, outcome === 'done' || outcome === 'budget' || outcome === 'killed' ? 'done' : outcome === 'infra' ? 'todo' : outcome === 'platform-block' ? 'needs-human' : 'failed');
    return { taskId, outcome, costUsd, usage, platformBlock: halt?.kind === 'platform-block' ? halt.text : null, summary };
  };

  let client: Awaited<ReturnType<RunTaskDeps['connect']>> | null = null;
  try {
    client = await deps.connect(`http://127.0.0.1:${identity.mcpHostPort}/mcp`, identity.mcpToken);
    const slug = identity.deviceSlug || null;
    const mcpTools = wrapTools(pickWorkerTools(await client.tools(), slug),
      (s) => { lastScreen = s; const b = detectPlatformBlock(s); if (b) halt = { kind: 'platform-block', text: b }; },
      (h) => { halt = h; });
    const ledgerTool = tool({
      description: 'Registra um item tratado nesta identidade e diz se já existia. Chame ANTES de tratar.',
      inputSchema: z.object({ item_key: z.string().min(3), author: z.string(), excerpt: z.string().max(300), draft_reply: z.string().max(500) }),
      execute: async (i) => { const already = ledgerHas(db, identity.id, i.item_key); if (!already) ledgerPut(db, identity.id, i.item_key, 'comment', `@${i.author}: ${i.excerpt} → rascunho: ${i.draft_reply}`); return { already }; },
    });
    const tools: ToolSet = { ...mcpTools, ledger_record: ledgerTool };
    const stopIfHalted: StopCondition<ToolSet> = () => halt !== null || o.isKilled();
    const anthropic = createAnthropic({ apiKey: o.apiKey });
    const messages: ModelMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT, providerOptions: { anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } } } },
      { role: 'user', content: taskInstruction(o.goalText) },
    ];
    const result = await deps.generate({
      model: anthropic(CONFIG.models.worker), messages, tools,
      toolApproval: buildToolApproval(slug, () => lastScreen, 'read-only') as never,
      stopWhen: [stepCountIs(budget), stopIfHalted],
      prepareStep: ({ messages: m }) => ({ messages: pruneScreens(m, CONFIG.worker.keepScreens) }),
      onStepFinish: (step) => {
        const r = recordStep(db, taskId, step as unknown as StepLike, HAIKU_PRICING); costUsd += r.costUsd;
        const u = readUsage(step.usage as never); usage.inputTokens += u.inputTokens; usage.outputTokens += u.outputTokens; usage.cacheReadTokens += u.cacheReadTokens;
        o.onStep();
      },
    });
    // `halt` é atribuído dentro de closures; o TS estreita o `let` para null e não vê isso — reler pelo tipo declarado.
    const finalHalt = halt as Halt;
    if (finalHalt?.kind === 'platform-block') return finish('platform-block', result.text);
    if (finalHalt?.kind === 'infra') return finish('infra', result.text);
    if (o.isKilled()) return finish('killed', result.text);
    return finish((result.steps?.length ?? 0) >= budget ? 'budget' : 'done', result.text);
  } catch (e) {
    const h = classify(e); if (h) halt = h;
    return finish(halt?.kind === 'infra' ? 'infra' : halt?.kind === 'platform-block' ? 'platform-block' : 'failed', String((e as Error).message ?? e));
  } finally {
    await client?.close().catch(() => undefined);
  }
}
