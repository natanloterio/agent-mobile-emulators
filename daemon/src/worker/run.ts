import { generateText, stepCountIs, tool, type LanguageModel, type ModelMessage, type StopCondition, type Tool, type ToolSet } from 'ai';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { CONFIG } from '../config.js';
import { setIdentityState, type IdentityRow } from '../db/identities.js';
import { setSubtaskReport, type SubtaskReport } from '../db/missions.js';
import { createGoalAndTask, createTask, finishGoal, ledgerHas, ledgerPut, markDegraded, setEarlyStop, setTaskState, startTask, writeIntent } from '../db/tasks.js';
import { providerLabel, readProviderConfig, type ProviderConfig, type ProviderRow } from '../provider/config.js';
import { isLocalInfraError, ProviderError } from '../provider/errors.js';
import { buildModel as defaultBuildModel, pricingFor, providerOptionsFor } from '../provider/factory.js';
import { createOllamaSupervisor, warnIfExternalOllama, type OllamaSupervisor } from '../provider/ollama.js';
import { createQualityFloor } from '../provider/quality.js';
import { connectMcp } from '../device/mcp.js';
import { detectLoggedOut, detectPlatformBlock } from '../screen/checks.js';
import { detectHumanCheck } from '../screen/human-check.js';
import { parseScreen, type ScreenState, type ScreenWindow } from '../screen/parse.js';
import { createPacer, type Pacer, type PacingConfig } from '../swarm/pacing.js';
import { buildToolApproval } from './gate.js';
import { buildMissionFinishMessages, MISSION_FINISH_STEPS, MISSION_FINISH_TOOLS, shouldRunMissionFinish } from './mission-finish.js';
import { MISSION_ESCALATION_NOTE, MISSION_FINISH_NUDGE, MISSION_SYSTEM_PROMPT, pickMissionTools } from './mission-prompt.js';
import { missionOutcome } from './mission-outcome.js';
import { maskOut, missionTools, type MissionRunCtx } from './mission-tools.js';
import { ESCALATION_NOTE, SYSTEM_PROMPT, taskInstruction } from './prompt.js';
import { isScreenTool, pruneScreens } from './prune.js';
import { readUsage, recordStep, textOf, type StepLike } from './record.js';
import { ACTION_TOOL, pickWorkerTools, toolPrefix } from './tools.js';
import { humanStopped, settleIdentity } from './stop.js';

export interface RunTaskOpts {
  readonly db: DatabaseSync; readonly identity: IdentityRow; readonly goalText: string; readonly apiKey: string;
  readonly isKilled: () => boolean; readonly onStep: () => void; readonly stepBudget?: number | null;
  readonly providers?: ProviderConfig;
  /**
   * Scheduler (spec inc. 5): objetivo/tarefa já criados e a instrução da fatia desta identidade.
   * Sem `taskId`, a tarefa é criada aqui (dentro de `goalId`, ou num objetivo próprio que runTask fecha ao terminar).
   */
  readonly goalId?: string; readonly taskId?: string; readonly instruction?: string;
  /** Pacing entre passos e teto de ações/hora (spec §4.3). Ausente = sem pacing (CLI/bench medem o worker cru). */
  readonly pacing?: PacingConfig;
  /** Modo missão (spec missões): sem gate, prompt e tools próprios, detecção de humano em qualquer app. A identidade fica com o loop. */
  readonly mission?: MissionRunCtx;
}
export interface RunTaskResult {
  /** `interrupted` = pausa ou controle humano no meio (spec inc. 5 §3.2): tarefa volta a todo. */
  readonly taskId: string; readonly outcome: 'done' | 'budget' | 'killed' | 'interrupted' | 'platform-block' | 'infra' | 'failed' | 'quality-floor';
  readonly costUsd: number; readonly usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
  readonly platformBlock: string | null; readonly summary: string;
  readonly degraded: boolean; readonly escalatedAtStep: number | null; readonly provider: string; readonly genMs: number; readonly invalidCalls: number;
  readonly earlyStopRemaining: number;
  /** Modo missão: relatório gravado na subtarefa e motivo quando precisa de humano. Fora de missão, sempre null. */
  readonly report: SubtaskReport | null; readonly humanReason: string | null;
}
/** Dependências injetáveis para teste: conexão MCP, geração, modelos (worker/esc), supervisor do Ollama e fábrica. */
export interface RunTaskDeps {
  readonly connect?: (url: string, token: string) => Promise<{ tools(): Promise<ToolSet>; close(): Promise<void> }>;
  readonly generate?: typeof generateText;
  readonly model?: LanguageModel;
  readonly escModel?: LanguageModel;
  readonly ollama?: OllamaSupervisor;
  readonly buildModel?: typeof defaultBuildModel;
  /** Pacer pronto (teste); ausente, é criado a partir de `opts.pacing`. */
  readonly pacer?: Pacer;
}

/** Paradas: bloqueio de plataforma, auth do MCP (token rotacionado — retry não resolve) e infra (device/rede). */
type Halt = { kind: 'platform-block' | 'auth' | 'infra' | 'infra-local'; text: string } | null;

const MAX_SCREEN_PAGES = 5;

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
  readonly mask?: (s: string) => string;
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

const CLICK_NODE = /click_node$/;
const NOT_CLICKABLE = /is not clickable/i;
const NOT_CLICKABLE_NOTE = 'click_node recusou: o nó não é clicável (o clicável costuma ser o contêiner). O daemon tocou o mesmo nó por coordenada com tap_node; leia a tela para ver o efeito.';

/** Acrescenta uma nota ao resultado MCP preservando o shape `content: [...]` (o toModelOutput do @ai-sdk/mcp exige). */
function withNote(out: unknown, note: string): unknown {
  if (out && typeof out === 'object' && Array.isArray((out as { content?: unknown }).content)) {
    return { ...(out as object), content: [{ type: 'text', text: note }, ...(out as { content: unknown[] }).content] };
  }
  return `${note}\n${typeof out === 'string' ? out : JSON.stringify(out)}`;
}

/** Envolve cada tool do MCP: write-ahead, isError → erro, leitura paginada, invalidação da tela após ação, classificação de falha. */
function wrapTools(tools: ToolSet, ctx: WrapCtx): ToolSet {
  let calls = 0;
  return Object.fromEntries(Object.entries(tools).map(([name, t]) => {
    const base = t as Tool & { execute?: (input: unknown, opts: unknown) => Promise<unknown> };
    const execute = async (input: unknown, opts: { toolCallId?: string }) => {
      const callId = opts?.toolCallId ?? `call-${++calls}`;
      ctx.pending.set(callId, writeIntent(ctx.db, ctx.taskId, name, input, `${ctx.taskId}:${callId}`));
      try {
        // Screenshot não é lido pelo parser e custa tokens; neste incremento a leitura é só de árvore.
        const effectiveInput = isScreenTool(name) ? { ...(input as object), include_screenshot: false } : input;
        const out = await base.execute!(effectiveInput, opts);
        if (isErrorResult(out)) { const msg = textOf(out) || `${name}: isError`; throw new Error(ctx.mask ? ctx.mask(msg) : msg); }
        if (isScreenTool(name)) {
          const all = await readAllPages(out, (i) => base.execute!(i, opts), effectiveInput);
          ctx.onScreen(all.screen);
          const text = ctx.mask ? ctx.mask(all.text) : all.text;
          // Preserva o shape MCP: o toModelOutput do @ai-sdk/mcp exige `content: [...]` (string lança TypeError).
          return typeof out === 'object' && out !== null ? { ...(out as object), content: [{ type: 'text', text }] } : text;
        }
        if (ACTION_TOOL.test(name)) ctx.onScreen(null); // a tela mudou; o gate nega até nova leitura
        return ctx.mask ? maskOut(out, ctx.mask) : out;
      } catch (e) {
        // Texto de item raramente é o nó clicável (o contêiner é): o mesmo nó, já aprovado pelo gate, recebe um toque por coordenada.
        const tap = CLICK_NODE.test(name) ? tools[name.replace(CLICK_NODE, 'tap_node')] as (Tool & { execute?: (i: unknown, o: unknown) => Promise<unknown> }) | undefined : undefined;
        if (tap?.execute && NOT_CLICKABLE.test(String((e as Error)?.message ?? e))) {
          const out = await tap.execute({ node_id: (input as { node_id?: unknown })?.node_id }, opts);
          if (isErrorResult(out)) throw new Error(textOf(out) || `${name}: tap_node de reserva falhou`);
          ctx.onScreen(null);
          const noted = withNote(out, NOT_CLICKABLE_NOTE);
          return ctx.mask ? maskOut(noted, ctx.mask) : noted;
        }
        // A mensagem crua pode ecoar o input da tool (ex.: um segredo digitado); mascarada antes do halt (achado
        // residual: só o erro que sobe ao modelo era mascarado, não o halt que vira resumo/motivo de pausa da missão).
        const h = classifyMcpError(e); if (h) ctx.onHalt(ctx.mask ? { ...h, text: ctx.mask(h.text) } : h);
        throw ctx.mask ? new Error(ctx.mask(String((e as Error)?.message ?? e))) : e;
      }
    };
    return [name, { ...base, execute } as Tool];
  }));
}

/** Tarefa do scheduler (taskId), tarefa nova num objetivo existente (goalId) ou objetivo+tarefa próprios (assinatura antiga). */
function openTask(db: DatabaseSync, identityId: string, o: RunTaskOpts): { taskId: string; ownGoalId: string | null } {
  if (o.taskId) { startTask(db, o.taskId); return { taskId: o.taskId, ownGoalId: null }; }
  if (o.goalId) return { taskId: createTask(db, o.goalId, identityId, o.instruction ?? o.goalText, 'running'), ownGoalId: null };
  const { goalId, taskId } = createGoalAndTask(db, identityId, o.instruction ?? o.goalText);
  return { taskId, ownGoalId: goalId };
}

export async function runTask(o: RunTaskOpts, depsIn: RunTaskDeps = {}): Promise<RunTaskResult> {
  const deps = { connect: depsIn.connect ?? connectMcp, generate: depsIn.generate ?? generateText, buildModel: depsIn.buildModel ?? defaultBuildModel, ollama: depsIn.ollama ?? createOllamaSupervisor() };
  const { db, identity } = o;
  // `null` = orçamento desligado (spec orçamento desligável): a tarefa roda até terminar, pausar ou o kill switch.
  const budget = o.stepBudget !== undefined ? o.stepBudget : CONFIG.worker.stepBudget;
  const cfg = o.providers ?? readProviderConfig(db);
  const { taskId, ownGoalId } = openTask(db, identity.id, o);
  const mission = o.mission ?? null;
  // Em missão, todo halt/summary vindo de erro cru passa por aqui antes de virar pausa/relatório; fora, é identidade.
  const maskHalt = (text: string): string => (mission ? mission.mask.mask(text) : text);
  // Em missão o loop é dono do estado da identidade (spec missões §Loop).
  if (!mission) setIdentityState(db, identity.id, 'running', { lastError: null });
  let report: SubtaskReport | null = null;
  // Parada por kill switch OU por pausa/controle humano desta identidade (lido do banco a cada passo).
  const stopped = () => o.isKilled() || humanStopped(db, identity.id);
  const pacer = depsIn.pacer ?? (o.pacing ? createPacer(db, identity.id, o.pacing, { shouldStop: stopped }) : null);

  let lastScreen: ScreenState | null = null; let halt: Halt = null; let costUsd = 0; let genMsTotal = 0; let lastGenMs: number | null = null;
  let degraded = false; let escalatedAtStep: number | null = null; let stepsUsed = 0;
  let lastNonEmptyText = ''; // missão: último texto não vazio, para o `did` automático sem finish_subtask
  // Passos do pedido final não contam como "orçamento esgotado": o gate só roda o pedido com orçamento de sobra.
  let missionFinishRan = false;
  let activeMode: ProviderRow['mode'] | null = null; // papel em execução, para classificar erro de API do provedor local
  const floor = createQualityFloor(CONFIG.worker.qualityFloor);
  const pending = new Map<string, number>();
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  const finish = (outcome: RunTaskResult['outcome'], summary: string): RunTaskResult => {
    const h = halt as Halt;
    const base = { taskId, outcome, costUsd, usage, platformBlock: h?.kind === 'platform-block' ? h.text : null, summary,
      degraded, escalatedAtStep, provider: providerLabel(cfg.worker), genMs: genMsTotal, invalidCalls: floor.count() };
    if (mission) {
      const m = missionOutcome({ outcome, report, halt: h, summary, budgetHit: budget !== null && stepsUsed >= budget && !missionFinishRan });
      if (m.report) setSubtaskReport(db, taskId, m.report);
      setTaskState(db, taskId, m.state);
      return { ...base, earlyStopRemaining: 0, report: m.report, humanReason: m.humanReason };
    }
    if (outcome === 'interrupted') settleIdentity(db, identity.id); // o humano manda: flags e estado dele ficam
    else {
      // infra-local (Ollama) não é problema do device: identidade volta a idle e a tarefa fica para repetir (spec §7).
      const idState = h?.kind === 'platform-block' ? 'needs-human' : h && h.kind !== 'infra-local' ? 'offline' : 'idle';
      setIdentityState(db, identity.id, idState, { lastError: h?.text ?? (outcome === 'failed' || outcome === 'quality-floor' ? summary.slice(0, 200) : null) });
    }
    const taskState = outcome === 'platform-block' ? 'needs-human' : outcome === 'failed' || outcome === 'quality-floor' ? 'failed'
      // Kill switch e pausa/controle não concluem a tarefa: volta a 'todo' (o objetivo do scheduler não conta como done).
      : outcome === 'infra' ? (h?.kind === 'auth' ? 'failed' : 'todo') : outcome === 'interrupted' || outcome === 'killed' ? 'todo' : 'done';
    setTaskState(db, taskId, taskState);
    if (ownGoalId) finishGoal(db, ownGoalId);
    const earlyStopRemaining = outcome === 'done' && budget !== null ? Math.max(0, budget - stepsUsed) : 0;
    setEarlyStop(db, taskId, earlyStopRemaining);
    return { ...base, earlyStopRemaining, report: null, humanReason: null };
  };

  /** Um segmento = um generateText sobre `messages` com um papel do registro (spec §5). */
  const segment = (row: ProviderRow, model: LanguageModel, tools: ToolSet, messages: ModelMessage[], stopIfHalted: StopCondition<ToolSet>, slug: string | null, steps: number | null, forcedTools?: readonly string[]) => {
    activeMode = row.mode;
    return deps.generate({
      model, tools, messages,
      // ai@7 rejeita role:'system' em messages; o system vai em instructions.
      instructions: mission ? MISSION_SYSTEM_PROMPT : SYSTEM_PROMPT,
      // Anthropic: uma tool por passo + cache 1h no nível da chamada; local: nada (o openai-compatible ignoraria).
      providerOptions: providerOptionsFor(row) as never,
      // Missão roda sem gate (decisão do spec missões); objetivos comuns continuam somente-leitura.
      ...(mission ? {} : { toolApproval: buildToolApproval(slug, () => lastScreen, 'read-only') as never }),
      // `steps === null` = orçamento desligado: sem stepCountIs, o segmento só para por halt/report/piso.
      stopWhen: [...(steps === null ? [] : [stepCountIs(steps)]), stopIfHalted, () => report !== null, () => floor.tripped() && row.role === 'worker'],
      // Pacing (spec §4.3): parada roda sem tools; `forcedTools` restringe o passo a um conjunto fixo (pedido final da missão).
      prepareStep: async ({ messages: m }) => {
        const go = pacer ? await pacer.beforeStep() : 'go';
        return { messages: pruneScreens(m, mission ? CONFIG.mission.keepScreens : CONFIG.worker.keepScreens), ...(go === 'stop' ? { activeTools: [] } : forcedTools ? { activeTools: forcedTools as string[] } : {}) };
      },
      onLanguageModelCallEnd: (e) => { lastGenMs = Math.round((e as { performance?: { responseTimeMs?: number } }).performance?.responseTimeMs ?? 0); },
      onStepFinish: (step) => {
        stepsUsed += 1;
        if (row.role === 'worker') floor.observe(step as unknown as StepLike);
        const r = recordStep(db, taskId, step as unknown as StepLike, pricingFor(row), pending, { provider: providerLabel(row), genMs: lastGenMs });
        costUsd += r.costUsd; genMsTotal += lastGenMs ?? 0; lastGenMs = null;
        const u = readUsage(step.usage as never); usage.inputTokens += u.inputTokens; usage.outputTokens += u.outputTokens; usage.cacheReadTokens += u.cacheReadTokens;
        o.onStep();
      },
    });
  };

  let client: Awaited<ReturnType<typeof deps.connect>> | null = null;
  try {
    // Provedor local: o Ollama tem de estar de pé antes de abrir a conversa (falha aqui é infra-local, não do device).
    if (cfg.worker.mode === 'local') warnIfExternalOllama(await deps.ollama.ensure(cfg.worker.endpoint, cfg.worker.model, cfg.worker.runtime));
    const model = depsIn.model ?? deps.buildModel(cfg.worker, { anthropicApiKey: o.apiKey });

    client = await deps.connect(`http://127.0.0.1:${identity.mcpHostPort}/mcp`, identity.mcpToken);
    const slug = identity.deviceSlug || null;
    const raw = await client.tools();
    const mcpTools = wrapTools(mission ? pickMissionTools(raw, slug) : pickWorkerTools(raw, slug), {
      db, taskId, pending, mask: mission?.mask.mask,
      onScreen: (s) => {
        lastScreen = s;
        // detectHumanCheck já mascara o rótulo antes do corte de 200; o pós-mask antigo virou redundante e saiu.
        const b = s ? (mission ? detectHumanCheck(s, mission.mask.mask) : detectPlatformBlock(s) ?? detectLoggedOut(s)) : null;
        if (b) halt = { kind: 'platform-block', text: b };
      },
      onHalt: (h) => { halt = h; },
    });
    const ledgerTool = tool({
      description: 'Registra um item tratado nesta identidade (item_key "<tipo>:<autor>:<trecho>") e diz se já existia. Chame ANTES de tratar.',
      inputSchema: z.object({ item_key: z.string().min(3), author: z.string(), excerpt: z.string().max(300), draft_reply: z.string().max(500) }),
      execute: async (i) => { const already = ledgerHas(db, identity.id, i.item_key); if (!already) ledgerPut(db, identity.id, i.item_key, i.item_key.split(':')[0] || 'item', `@${i.author}: ${i.excerpt} → rascunho: ${i.draft_reply}`, taskId); return { already }; },
    });
    // type_secret digita pela tool crua do MCP: o texto não passa pelo wrapper, então não vira step.
    const typeRaw = raw[`${toolPrefix(slug)}type_append_text`] as (Tool & { execute?: (i: unknown, o: unknown) => Promise<unknown> }) | undefined;
    const extra: ToolSet = mission ? missionTools({
      ...mission, db,
      typeText: async (nodeId, text) => {
        if (!typeRaw?.execute) throw new Error('type_append_text ausente no MCP');
        let out: unknown;
        try {
          out = await typeRaw.execute({ node_id: nodeId, text }, { toolCallId: `secret-${nodeId}`, messages: [] });
        } catch (e) {
          // O erro cru do MCP pode ecoar os parâmetros (a senha); nunca sobe como veio, nem vira halt cru (achado
          // residual: o halt ia sem máscara até o resumo/motivo de pausa). Infra ainda pausa a missão.
          const h = classifyMcpError(e); if (h) halt = { ...h, text: maskHalt(h.text) };
          throw new Error('type_append_text falhou no device');
        }
        if (isErrorResult(out)) throw new Error('type_append_text falhou no device');
      },
      onFinish: (r) => { report = r; },
      onHuman: (reason) => { halt = { kind: 'platform-block', text: reason }; },
      onVaultError: (text) => { halt = { kind: 'infra', text }; },
    }) : { ledger_record: ledgerTool };
    const tools: ToolSet = { ...mcpTools, ...extra };
    const stopIfHalted: StopCondition<ToolSet> = () => halt !== null || stopped();
    const messages: ModelMessage[] = [{ role: 'user', content: mission ? (o.instruction ?? o.goalText) : taskInstruction(o.instruction ?? o.goalText) }];

    let history: ModelMessage[] = messages;
    let currentRow = cfg.worker; let currentModel = model;
    let result = await segment(currentRow, currentModel, tools, history, stopIfHalted, slug, budget);
    if (mission && result.text.trim()) lastNonEmptyText = result.text;

    // Orçamento desligado: escalonamento continua possível (sem teto a respeitar).
    const remaining = budget === null ? Infinity : budget - stepsUsed;
    if (floor.tripped() && !halt && !stopped() && remaining > 0 && report === null) {
      const canEscalate = cfg.esc.mode === 'nuvem' && !!o.apiKey;
      if (!canEscalate) return finish('quality-floor', `piso de qualidade: ${floor.count()} tool calls inválidas com ${providerLabel(cfg.worker)}; sem escalonamento na nuvem`);
      degraded = true; escalatedAtStep = stepsUsed; markDegraded(db, taskId, stepsUsed);
      currentRow = cfg.esc; currentModel = depsIn.escModel ?? deps.buildModel(cfg.esc, { anthropicApiKey: o.apiKey });
      // O SDK descarta dos response.messages os passos com tool call inválida; a nota conta ao esc o que aconteceu.
      const note = mission ? MISSION_ESCALATION_NOTE(floor.count(), cfg.worker.model) : ESCALATION_NOTE(floor.count(), cfg.worker.model);
      history = [...history, ...result.response.messages, { role: 'user', content: note }];
      result = await segment(currentRow, currentModel, tools, history, stopIfHalted, slug, remaining);
      if (mission && result.text.trim()) lastNonEmptyText = result.text;
    }

    // Executor terminou sem finish_subtask: um pedido final curto antes de a subtarefa falhar (spec missões §Executor).
    if (shouldRunMissionFinish({ mission: !!mission, report, halted: !!halt, stopped: stopped(), budget, stepsUsed })) {
      missionFinishRan = true;
      history = buildMissionFinishMessages(history, result.response.messages, MISSION_FINISH_NUDGE);
      result = await segment(currentRow, currentModel, tools, history, stopIfHalted, slug, MISSION_FINISH_STEPS, MISSION_FINISH_TOOLS);
      if (result.text.trim()) lastNonEmptyText = result.text;
    }

    const h = halt as Halt;
    if (h?.kind === 'platform-block') return finish('platform-block', result.text);
    // Em missão o motivo da parada (device, cofre) vira o resumo mostrado ao pausar; maskHalt é reforço (h.text já
    // vem mascarado da origem: onHalt/typeText/onScreen).
    if (h) return finish('infra', mission ? maskHalt(h.text) : result.text);
    if (o.isKilled()) return finish('killed', result.text);
    if (humanStopped(db, identity.id)) return finish('interrupted', result.text);
    // Sem finish_subtask o texto final pode vir vazio (parou em tool call); o último texto não vazio vira o `did`.
    return finish(budget !== null && stepsUsed >= budget ? 'budget' : 'done', mission ? (result.text.trim() || lastNonEmptyText) : result.text);
  } catch (e) {
    // Erro fora das tools (ex.: chave da Anthropic inválida) é falha da tarefa, não do device.
    const h = halt as Halt;
    if (h?.kind === 'platform-block') return finish('platform-block', maskHalt(String((e as Error).message ?? e)));
    if (h) return finish('infra', maskHalt(String((e as Error).message ?? e)));
    if (ProviderError.isInstance(e)) {
      // Chave ausente é falha da tarefa, não do device: identidade volta a idle (spec inc. 3 §4.4). Em missão, pausa a missão.
      if (e.kind === 'auth') { if (mission) { const text = maskHalt(e.message); halt = { kind: 'auth', text }; return finish('infra', text); } return finish('failed', e.message); }
      const text = maskHalt(e.message); halt = { kind: e.kind, text }; return finish('infra', text);
    }
    // Ollama caiu/recusou/OOM no meio da tarefa: infra-local → tarefa volta a todo, identidade idle (spec §7).
    if (activeMode === 'local' && isLocalInfraError(e)) { const text = maskHalt(String((e as Error).message ?? e).slice(0, 200)); halt = { kind: 'infra-local', text }; return finish('infra', text); }
    // Missão: infra ANTES do loop (connect, client.tools(), ollama.ensure) também interrompe a subtarefa, nunca falha (spec missões §Erros).
    if (mission) {
      const mc = classifyMcpError(e);
      if (mc) { const text = maskHalt(mc.text); halt = { ...mc, text }; return finish('infra', text); }
      if (isLocalInfraError(e)) { const text = maskHalt(String((e as Error).message ?? e).slice(0, 200)); halt = { kind: 'infra-local', text }; return finish('infra', text); }
    }
    return finish('failed', maskHalt(String((e as Error).message ?? e)));
  } finally {
    await client?.close().catch(() => undefined);
  }
}
