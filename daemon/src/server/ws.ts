import type http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { FleetSnapshot } from './snapshot.js';

export function attachWs(server: http.Server, token: string, snapshot: () => FleetSnapshot): { broadcast(): void; close(): void } {
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/ws' || url.searchParams.get('token') !== token) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => { wss.emit('connection', ws, req); ws.send(JSON.stringify({ type: 'snapshot', data: snapshot() })); });
  });
  const broadcast = () => {
    const msg = JSON.stringify({ type: 'snapshot', data: snapshot() });
    for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(msg);
  };
  return { broadcast, close: () => { for (const c of wss.clients) c.terminate(); wss.close(); } };
}
