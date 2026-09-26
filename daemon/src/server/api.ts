import http from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { CLOUD_MODELS, ollamaBase, patchErrorMessage, ProviderPatch, readProviderConfig, ROLE_KEYS, updateProvider, type RoleKey } from '../provider/config.js';
import { lastProviderTests, type ProviderTest } from '../provider/probe.js';
import { buildSnapshot } from './snapshot.js';
import { attachWs } from './ws.js';

const GoalBody = z.object({ text: z.string().min(3).max(2000) });
const PROVIDERS_ROUTE = /^\/providers(?:\/([a-z]+))?(\/test)?$/;
const isRole = (x: string): x is RoleKey => (ROLE_KEYS as readonly string[]).includes(x);

export interface ServerOpts {
  readonly db: DatabaseSync; readonly port?: number; readonly token: string;
  readonly onGoal: (text: string) => Promise<void>; readonly onKill: () => void;
  readonly onProviderTest: (role: RoleKey) => Promise<ProviderTest>;
  readonly fetch?: typeof fetch;
}

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
  const send = (res: http.ServerResponse, code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.headers.authorization !== `Bearer ${o.token}`) return send(res, 401, { error: 'unauthorized' });
      if (req.method === 'GET' && url.pathname === '/state') return send(res, 200, buildSnapshot(o.db, killed));
      if (req.method === 'POST' && url.pathname === '/goals') {
        const parsed = GoalBody.safeParse(await readJson(req));
        if (!parsed.success) return send(res, 400, { error: parsed.error.issues.map((i) => i.message) });
        if (inFlight) return send(res, 409, { error: 'já existe um objetivo em execução' });
        inFlight = true;
        o.onGoal(parsed.data.text).catch((e: unknown) => console.error('[daemon] objetivo falhou:', e)).finally(() => { inFlight = false; });
        return send(res, 202, { accepted: true });
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
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      return sendError(res, e);
    }
  });
  const ws = attachWs(server, o.token, () => buildSnapshot(o.db, killed));
  await new Promise<void>((r) => server.listen(o.port ?? 47800, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return { port, broadcast: ws.broadcast, isKilled: () => killed, close: async () => { ws.close(); await new Promise<void>((r) => server.close(() => r())); } };
}
