export interface WsHandlers { onSnapshot(d: unknown): void; onFrame(d: unknown): void; onVideo(d: unknown): void }
/** Despacho puro das mensagens do daemon (spec inc. 4 §4.2): testável sem socket. */
export function dispatchWsMessage(raw: string, h: WsHandlers): void {
  let msg: { type?: unknown; data?: unknown };
  try { msg = JSON.parse(raw) as { type?: unknown; data?: unknown }; } catch { return; }
  if (msg.type === 'snapshot') h.onSnapshot(msg.data);
  else if (msg.type === 'frame') h.onFrame(msg.data);
  else if (msg.type === 'video') h.onVideo(msg.data);
}
