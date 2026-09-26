import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText, stepCountIs, tool, type LanguageModel, type ModelMessage, type StopCondition, type Tool, type ToolSet } from 'ai';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { CONFIG } from '../config.js';
import { setIdentityState, type IdentityRow } from '../db/identities.js';
import { createGoalAndTask, ledgerHas, ledgerPut, setTaskState, writeIntent } from '../db/tasks.js';
import { connectMcp } from '../device/mcp.js';
import { detectPlatformBlock } from '../screen/checks.js';
import { parseScreen, type ScreenState, type ScreenWindow } from '../screen/parse.js';
import { buildToolApproval } from './gate.js';
import { SYSTEM_PROMPT, taskInstruction } from './prompt.js';
import { isScreenTool, pruneScreens } from './prune.js';
import { HAIKU_PRICING, readUsage, recordStep, textOf, type StepLike } from './record.js';
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
/** Dependências injetáveis para teste: conexão MCP, função de geração e o próprio modelo (generateText real + mock). */
export interface RunTaskDeps {
  readonly connect?: (url: string, token: string) => Promise<{ tools(): Promise<ToolSet>; close(): Promise<void> }>;
  readonly generate?: typeof generateText;
  readonly model?: LanguageModel;
}

/** Paradas: bloqueio de plataforma, auth do MCP (token rotacionado — retry não resolve) e infra (device/rede). */
type Halt = { kind: 'platform-block' | 'auth' | 'infra'; text: string } | null;

const MAX_SCREEN_PAGES = 5;
const ACTION_TOOL = /_(click_node|tap_node|scroll|scroll_to_node|press_back|open_app|type_append_text|type_replace_text|type_clear_text|swipe|long_press|press_key)$/;

/** Só erros vindos do MCP/device são classificados; erro benigno de tool (ex.: "Node not found within timeout") fica como tool-error. */
export function classifyMcpError(e: unknown): Halt {
  const msg = String((e as Error)?.message ?? e);
  if (/\b(401|403)\b|unauthorized|forbidden/i.test(msg)) return { kind: 'auth', text: msg.slice(0, 200) };
  if (/device '[^']*' not found|no devices\/emulators|ECONNREFUSED|ECONNRESET|fetch failed|device offline/i.test(msg)) return { kind: 'infra', text: msg.slice(0, 200) };
  return null;
}

interface WrapCtx {
  readonly db: DatabaseSync; readonly taskId: string; readonly pending: Map<string, number>;
  readonly onScreen: (s: ScreenState | null) => void; readonly onHalt: (h: Halt) => void;
}

/** Linhas de controle de paginação que não devem chegar ao modelo (ele não pagina; o wrapper pagina). */
const PAGINATION_LINE = /^(?:(?:next_)?cursor:|page:\d+\/\d+ snapshot:|note:more nodes available|note:end of snapshot)/;

/** Funde janelas iguais (pkg/type/title/focused) de páginas diferentes, para a janela focada conter todos os nós. */
function mergeWindows(pages: readonly ScreenState[]): ScreenState {
  const byKey = new Map<string, ScreenWindow>();
  for (const p of pages) for (const w of p.windows) {
    const k = `${w.pkg}|${w.type}|${w.title}|${w.focused}`;
    const prev = byKey.get(k);
    byKey.set(k, prev ? { ...prev, nodes: [...prev.nodes, ...w.nodes] } : w);
  }
  const first = pages[0];
  return { width: first.width, height: first.height, cursor: null, windows: [...byKey.values()] };
}

/** Lê todas as páginas de um screen state (spec Review Focus 2) e devolve texto fundido sem as linhas de paginação. */
async function readAllPages(first: unknown, exec: (input: unknown) => Promise<unknown>, input: unknown): Promise<{ text: string; screen: ScreenState }> {
  const texts = [textOf(first)]; const pages = [parseScreen(texts[0])];
  for (let n = 1; pages[pages.length - 1].cursor && n < MAX_SCREEN_PAGES; n++) {
    const next = await exec({ ...(input as object), cursor: pages[pages.length - 1].cursor });
    if (isErrorResult(next)) break;
    texts.push(textOf(next)); pages.push(parseScreen(texts[texts.length - 1]));
  }
  const text = texts.map((t, i) => t.split('\n').filter((l) => !PAGINATION_LINE.test(l) && (i === 0 || !l.startsWith('screen:'))).join('\n')).join('\n');
  return { text, screen: mergeWindows(pages) };
}

const isErrorResult = (out: unknown): boolean => !!out && typeof out === 'object' && (out as { isError?: boolean }).isError === true;

/** Envolve cada tool do MCP: write-ahead, isError → erro, leitura paginada, invalidação da tela após ação, classificação de falha. */
function wrapTools(tools: ToolSet, ctx: WrapCtx): ToolSet {
  let idx = 0;
  return Object.fromEntries(Object.entries(tools).map(([name, t]) => {
    const base = t as Tool & { execute?: (input: unknown, opts: unknown) => Promise<unknown> };
    const execute = async (input: unknown, opts: { toolCallId?: string }) => {
      const callId = opts?.toolCallId ?? `call-${idx}`;
      ctx.pending.set(callId, writeIntent(ctx.db, ctx.taskId, ++idx, name, input, `${ctx.taskId}:${callId}`));
      try {
        // Screenshot não é lido pelo parser e custa tokens; neste incremento a leitura é só de árvore.
        const effectiveInput = isScreenTool(name) ? { ...(input as object), include_screenshot: false } : input;
        const out = await base.execute!(effectiveInput, opts);
        if (isErrorResult(out)) throw new Error(textOf(out) || `${name}: isError`);
        if (isScreenTool(name)) {
          const all = await readAllPages(out, (i) => base.execute!(i, opts), effectiveInput);
          ctx.onScreen(all.screen);
          // Preserva o shape MCP: o toModelOutput do @ai-sdk/mcp exige `content: [...]` (string lança TypeError).
          return typeof out === 'object' && out !== null ? { ...(out as object), content: [{ type: 'text', text: all.text }] } : all.text;
        }
        if (ACTION_TOOL.test(name)) ctx.onScreen(null); // a tela mudou; o gate nega até nova leitura
        return out;
      } catch (e) { const h = classifyMcpError(e); if (h) ctx.onHalt(h); throw e; }
    };
    return [name, { ...base, execute } as Tool];
  }));
}

export async function runTask(o: RunTaskOpts, depsIn: RunTaskDeps = {}): Promise<RunTaskResult> {
  const deps = { connect: depsIn.connect ?? connectMcp, generate: depsIn.generate ?? generateText };
  const { db, identity } = o;
  const budget = o.stepBudget ?? Number(process.env.ENXAME_STEP_BUDGET ?? CONFIG.worker.stepBudget);
  const { taskId } = createGoalAndTask(db, identity.id, o.goalText);
  setIdentityState(db, identity.id, 'running', { lastError: null });

  let lastScreen: ScreenState | null = null; let halt: Halt = null; let costUsd = 0;
  const pending = new Map<string, number>();
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  const finish = (outcome: RunTaskResult['outcome'], summary: string): RunTaskResult => {
    const h = halt as Halt;
    const idState = h?.kind === 'platform-block' ? 'needs-human' : h ? 'offline' : 'idle';
    setIdentityState(db, identity.id, idState, { lastError: h?.text ?? (outcome === 'failed' ? summary.slice(0, 200) : null) });
    const taskState = outcome === 'platform-block' ? 'needs-human' : outcome === 'failed' ? 'failed'
      : outcome === 'infra' ? (h?.kind === 'auth' ? 'failed' : 'todo') : 'done';
    setTaskState(db, taskId, taskState);
    return { taskId, outcome, costUsd, usage, platformBlock: h?.kind === 'platform-block' ? h.text : null, summary };
  };

  let client: Awaited<ReturnType<typeof deps.connect>> | null = null;
  try {
    client = await deps.connect(`http://127.0.0.1:${identity.mcpHostPort}/mcp`, identity.mcpToken);
    const slug = identity.deviceSlug || null;
    const mcpTools = wrapTools(pickWorkerTools(await client.tools(), slug), {
      db, taskId, pending,
      onScreen: (s) => { lastScreen = s; const b = s ? detectPlatformBlock(s) : null; if (b) halt = { kind: 'platform-block', text: b }; },
      onHalt: (h) => { halt = h; },
    });
    const ledgerTool = tool({
      description: 'Registra um item tratado nesta identidade e diz se já existia. Chame ANTES de tratar.',
      inputSchema: z.object({ item_key: z.string().min(3), author: z.string(), excerpt: z.string().max(300), draft_reply: z.string().max(500) }),
      execute: async (i) => { const already = ledgerHas(db, identity.id, i.item_key); if (!already) ledgerPut(db, identity.id, i.item_key, 'comment', `@${i.author}: ${i.excerpt} → rascunho: ${i.draft_reply}`); return { already }; },
    });
    const tools: ToolSet = { ...mcpTools, ledger_record: ledgerTool };
    const stopIfHalted: StopCondition<ToolSet> = () => halt !== null || o.isKilled();
    const model: LanguageModel = depsIn.model ?? createAnthropic({ apiKey: o.apiKey })(CONFIG.models.worker);
    const messages: ModelMessage[] = [{ role: 'user', content: taskInstruction(o.goalText) }];
    const result = await deps.generate({
      model, tools, messages,
      // ai@7 rejeita role:'system' em messages; o system vai em instructions.
      instructions: SYSTEM_PROMPT,
      // Uma tool por passo: o gate decide com a tela que o modelo acabou de ler, nunca em paralelo com uma ação.
      // cacheControl no nível da chamada: o schema de opções da mensagem de sistema do provider não o aceita (medido: cache 0).
      providerOptions: { anthropic: { disableParallelToolUse: true, cacheControl: { type: 'ephemeral', ttl: '1h' } } },
      toolApproval: buildToolApproval(slug, () => lastScreen, 'read-only') as never,
      stopWhen: [stepCountIs(budget), stopIfHalted],
      prepareStep: ({ messages: m }) => ({ messages: pruneScreens(m, CONFIG.worker.keepScreens) }),
      onStepFinish: (step) => {
        const r = recordStep(db, taskId, step as unknown as StepLike, HAIKU_PRICING, pending); costUsd += r.costUsd;
        const u = readUsage(step.usage as never); usage.inputTokens += u.inputTokens; usage.outputTokens += u.outputTokens; usage.cacheReadTokens += u.cacheReadTokens;
        o.onStep();
      },
    });
    const h = halt as Halt;
    if (h?.kind === 'platform-block') return finish('platform-block', result.text);
    if (h) return finish('infra', result.text);
    if (o.isKilled()) return finish('killed', result.text);
    return finish((result.steps?.length ?? 0) >= budget ? 'budget' : 'done', result.text);
  } catch (e) {
    // Erro fora das tools (ex.: chave da Anthropic inválida) é falha da tarefa, não do device.
    const h = halt as Halt;
    if (h?.kind === 'platform-block') return finish('platform-block', String((e as Error).message ?? e));
    if (h) return finish('infra', String((e as Error).message ?? e));
    return finish('failed', String((e as Error).message ?? e));
  } finally {
    await client?.close().catch(() => undefined);
  }
}
