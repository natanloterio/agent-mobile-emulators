import http from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { buildSnapshot } from './snapshot.js';
import { attachWs } from './ws.js';

const GoalBody = z.object({ text: z.string().min(3).max(2000) });

export interface ServerOpts {
  readonly db: DatabaseSync; readonly port?: number; readonly token: string;
  readonly onGoal: (text: string) => Promise<void>; readonly onKill: () => void;
}

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve(null); } }); });
}

export interface RunningServer { readonly port: number; broadcast(): void; isKilled(): boolean; close(): Promise<void> }

export async function startServer(o: ServerOpts): Promise<RunningServer> {
  let killed = false;
  let inFlight = false;
  const send = (res: http.ServerResponse, code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const server = http.createServer(async (req, res) => {
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
    return send(res, 404, { error: 'not found' });
  });
  const ws = attachWs(server, o.token, () => buildSnapshot(o.db, killed));
  await new Promise<void>((r) => server.listen(o.port ?? 47800, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return { port, broadcast: ws.broadcast, isKilled: () => killed, close: async () => { ws.close(); await new Promise<void>((r) => server.close(() => r())); } };
}
