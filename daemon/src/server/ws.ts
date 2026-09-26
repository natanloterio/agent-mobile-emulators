import type http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { Frame, ScreenCapture } from '../device/screen.js';
import type { VideoPacket, VideoStreams } from '../device/video.js';
import type { FleetSnapshot } from './snapshot.js';

const frameMsg = (f: Frame): string => JSON.stringify({ type: 'frame', data: { id: f.id, at: f.at, png: f.png } });
const videoMsg = (p: VideoPacket): string =>
  JSON.stringify({ type: 'video', data: { id: p.id, seq: p.seq, key: p.key, nal: p.data.toString('base64') } });

export function attachWs(
  server: http.Server, token: string, snapshot: () => FleetSnapshot, screen?: ScreenCapture, video?: VideoStreams,
): { broadcast(): void; close(): void } {
  const wss = new WebSocketServer({ noServer: true });
  const sendAll = (msg: string) => { for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(msg); };
  // Captura e vídeo só correm com alguém assistindo (spec inc. 4 §4.1).
  const syncActive = () => { const on = wss.clients.size > 0; screen?.setActive(on); video?.setActive(on); };
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/ws' || url.searchParams.get('token') !== token) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
      ws.send(JSON.stringify({ type: 'snapshot', data: snapshot() }));
      for (const f of screen?.all() ?? []) ws.send(frameMsg(f));
      ws.on('close', syncActive);
      syncActive();
    });
  });
  const unsubFrame = screen?.onFrame((f) => sendAll(frameMsg(f)));
  const unsubVideo = video?.onPacket((p) => sendAll(videoMsg(p)));
  const broadcast = () => sendAll(JSON.stringify({ type: 'snapshot', data: snapshot() }));
  return { broadcast, close: () => { unsubFrame?.(); unsubVideo?.(); for (const c of wss.clients) c.terminate(); wss.close(); } };
}
