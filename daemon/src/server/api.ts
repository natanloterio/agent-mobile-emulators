import http from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { GoalPlanSchema, type GoalPlan } from '../leader/types.js';
import { CLOUD_MODELS, ollamaBase, patchErrorMessage, ProviderPatch, readProviderConfig, ROLE_KEYS, updateProvider, type RoleKey } from '../provider/config.js';
import { lastProviderTests, type ProviderTest } from '../provider/probe.js';
import type { ScreenCapture } from '../device/screen.js';
import type { VideoState, VideoStreams } from '../device/video.js';
import { buildSnapshot, listGoals, type HostMetrics, type SnapshotSources } from './snapshot.js';
import { attachWs } from './ws.js';

export const GoalText = z.string().min(3).max(2000);
/** `plan` é o GoalPlan devolvido por POST /goals/plan (spec inc. 5 §3.2); ausente, o daemon planeja antes. */
const GoalBody = z.object({ text: GoalText, plan: GoalPlanSchema.optional() });
const PROVIDERS_ROUTE = /^\/providers(?:\/([a-z]+))?(\/test)?$/;
const isRole = (x: string): x is RoleKey => (ROLE_KEYS as readonly string[]).includes(x);

export interface ServerOpts {
  readonly db: DatabaseSync; readonly port?: number; readonly token: string;
  /**
   * Cria o objetivo (planejando antes se `plan` for null) e devolve o goalId já gravado; `done` resolve quando ele termina.
   * Enquanto `done` não resolve, novos objetivos e trocas de provedor recebem 409.
   */
  readonly onGoal: (text: string, plan: GoalPlan | null) => Promise<GoalStart>; readonly onKill: () => void;
  readonly onProviderTest: (role: RoleKey) => Promise<ProviderTest>;
  readonly fetch?: typeof fetch;
  /** Posters/fallback (screencap) e vídeo ao vivo (spec inc. 4); ausentes, o WS só manda snapshots. */
  readonly screen?: ScreenCapture; readonly video?: VideoStreams;
  /** Estado do stream por identidade, publicado no snapshot (`identities[].video`); ausente = 'idle'. */
  readonly videoState?: (id: string) => VideoState;
  /** Métricas do host publicadas no snapshot (spec inc. 5 §3.1); ausente = null. */
  readonly host?: () => HostMetrics | null;
  /** Rotas de outras frentes (spec inc. 5 §3.2): avaliadas antes do 404, na ordem; `true` = tratou. */
  readonly routes?: readonly Route[];
}

export interface GoalStart { readonly goalId: string; readonly done: Promise<unknown> }

/** Contexto de uma rota plugável. `send` responde JSON; `body()` lê o corpo uma vez (JSON inválido → null). */
export interface RouteCtx {
  readonly req: http.IncomingMessage; readonly url: URL; readonly method: string;
  readonly db: DatabaseSync;
  send(code: number, body?: unknown): void;
  body(): Promise<unknown>;
  broadcast(): void;
  isKilled(): boolean;
  /** Objetivo (ou teste de provedor) em execução. */
  busy(): boolean;
  /** Toma o mesmo lock de objetivo/teste (ex.: planejamento, que sonda os devices); `null` se ocupado. */
  lock(): (() => void) | null;
}
export type Route = (ctx: RouteCtx) => boolean | Promise<boolean>;

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve(null); } }); });
}

/** Leitura pura da lista de modelos do Ollama; nunca sobe o daemon (spec inc. 3 §4.5). */
async function listOllamaModels(fetchFn: typeof fetch, base: string): Promise<{ models: string[]; error: string | null }> {
  let r: Response;
  try { r = await fetchFn(`${base}/api/tags`); }
  catch { return { models: [], error: 'Ollama parado — o próximo teste ou objetivo o sobe' }; }
  if (!r.ok) return { models: [], error: `Ollama respondeu ${r.status} em /api/tags` };
  try {
    const j = await r.json() as { models?: { name: string }[] };
    if (!Array.isArray(j.models)) return { models: [], error: 'resposta inválida do Ollama em /api/tags' };
    return { models: j.models.map((m) => m.name), error: null };
  } catch { return { models: [], error: 'resposta inválida do Ollama em /api/tags' }; }
}

export interface RunningServer { readonly port: number; broadcast(): void; isKilled(): boolean; close(): Promise<void> }

export async function startServer(o: ServerOpts): Promise<RunningServer> {
  let killed = false;
  let inFlight = false;
  const fetchFn = o.fetch ?? fetch;
  // Um throw depois do `send` (ex.: `ws.broadcast`) não pode virar um segundo writeHead: ERR_HTTP_HEADERS_SENT
  // rejeitaria o handler async sem tratamento, fatal no Node 24.
  const sendError = (res: http.ServerResponse, e: unknown) => {
    if (res.headersSent) { console.error('[daemon] erro após resposta enviada:', e); return; }
    send(res, 500, { error: String((e as Error).message ?? e) });
  };
  const send = (res: http.ServerResponse, code: number, body: unknown) => {
    if (code === 204 || body === undefined) { res.writeHead(code); res.end(); return; }
    res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body));
  };
  const sources: SnapshotSources = { videoState: o.videoState, host: o.host };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.headers.authorization !== `Bearer ${o.token}`) return send(res, 401, { error: 'unauthorized' });
      if (req.method === 'GET' && url.pathname === '/state') return send(res, 200, buildSnapshot(o.db, killed, sources));
      if (req.method === 'GET' && url.pathname === '/goals') return send(res, 200, { goals: listGoals(o.db) });
      if (req.method === 'POST' && url.pathname === '/goals') {
        const parsed = GoalBody.safeParse(await readJson(req));
        if (!parsed.success) return send(res, 400, { error: parsed.error.issues.map((i) => i.message) });
        if (inFlight) return send(res, 409, { error: 'já existe um objetivo em execução' });
        if (killed) return send(res, 409, { error: 'kill switch acionado: POST /resume antes de um novo objetivo' });
        inFlight = true;
        let started: GoalStart;
        try { started = await o.onGoal(parsed.data.text, parsed.data.plan ?? null); }
        catch (e) { inFlight = false; return sendError(res, e); }
        started.done.catch((e: unknown) => console.error('[daemon] objetivo falhou:', e)).finally(() => { inFlight = false; ws.broadcast(); });
        send(res, 202, { goalId: started.goalId }); ws.broadcast(); return;
      }
      if (req.method === 'POST' && url.pathname === '/kill') { killed = true; o.onKill(); return send(res, 200, { killed: true }); }
      if (req.method === 'POST' && url.pathname === '/resume') { killed = false; return send(res, 200, { killed: false }); }
      if (req.method === 'GET' && url.pathname === '/providers/models') {
        const role = url.searchParams.get('role') ?? '';
        if (!isRole(role)) return send(res, 404, { error: 'papel desconhecido' });
        const cfg = readProviderConfig(o.db)[role];
        if (cfg.mode === 'nuvem') return send(res, 200, { source: 'anthropic', models: CLOUD_MODELS, error: null });
        const { models, error } = await listOllamaModels(fetchFn, ollamaBase(cfg.endpoint));
        return send(res, 200, { source: 'ollama', models, error });
      }
      const prov = PROVIDERS_ROUTE.exec(url.pathname);
      if (prov) {
        const [, role, isTest] = prov;
        if (req.method === 'GET' && !role) return send(res, 200, { config: readProviderConfig(o.db), tests: lastProviderTests(o.db) });
        if (!role || !isRole(role)) return send(res, 404, { error: 'papel desconhecido' });
        if (req.method === 'PUT' && !isTest) {
          const parsed = ProviderPatch.safeParse(await readJson(req));
          if (!parsed.success) return send(res, 400, { error: patchErrorMessage(parsed.error) });
          // Trocar modelo no meio de uma conversa muda prefixo e comportamento; teste e tarefa disputam o mesmo device.
          if (inFlight) return send(res, 409, { error: 'objetivo ou teste em execução; troca de provedor só com a frota parada' });
          const row = updateProvider(o.db, role, parsed.data); send(res, 200, row); ws.broadcast(); return;
        }
        if (req.method === 'POST' && isTest) {
          if (inFlight) return send(res, 409, { error: 'objetivo ou teste em execução' });
          inFlight = true;
          try { const t = await o.onProviderTest(role); send(res, 200, t); ws.broadcast(); return; }
          catch (e) { return sendError(res, e); }
          finally { inFlight = false; }
        }
      }
      if (o.routes?.length) {
        let bodyP: Promise<unknown> | null = null;
        const ctx: RouteCtx = {
          req, url, method: req.method ?? 'GET', db: o.db,
          send: (code, body) => send(res, code, body),
          body: () => (bodyP ??= readJson(req)),
          broadcast: () => ws.broadcast(), isKilled: () => killed, busy: () => inFlight,
          lock: () => { if (inFlight) return null; inFlight = true; let released = false; return () => { if (!released) { released = true; inFlight = false; } }; },
        };
        for (const route of o.routes) if (await route(ctx)) return;
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      return sendError(res, e);
    }
  });
  const ws = attachWs(server, o.token, () => buildSnapshot(o.db, killed, sources), o.screen, o.video);
  await new Promise<void>((r) => server.listen(o.port ?? 47800, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return { port, broadcast: ws.broadcast, isKilled: () => killed, close: async () => { ws.close(); await new Promise<void>((r) => server.close(() => r())); } };
}
