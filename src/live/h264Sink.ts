import type { LiveVideoPacket } from './types';

export interface SinkState { readonly configured: boolean; readonly waitingKey: boolean; readonly errors: number; readonly lastSeq: number | null }
export type SinkAction = 'configure' | 'decode' | 'skip' | 'reset';
export type SinkInput = { readonly key: boolean; readonly seq: number } | { readonly error: true };

/**
 * Máquina de estados pura do decoder (spec inc. 4 §4.3): configura no primeiro key, reseta em erro e espera o próximo key.
 * Delta com seq <= último aceito é duplicata (pacote ao vivo + reenvio do GOP numa recarga) e é descartado; key sempre é aceito.
 */
export function nextAction(s: SinkState, p: SinkInput): { action: SinkAction; state: SinkState } {
  if ('error' in p) return { action: 'reset', state: { ...s, configured: false, waitingKey: true, errors: s.errors + 1 } };
  if (!p.key && (s.waitingKey || (s.lastSeq !== null && p.seq <= s.lastSeq))) return { action: 'skip', state: s };
  if (!s.configured || (p.key && s.waitingKey)) return { action: 'configure', state: { ...s, configured: true, waitingKey: false, lastSeq: p.seq } };
  return { action: 'decode', state: { ...s, lastSeq: p.seq } };
}

const CODEC = 'avc1.42E01E';
const b64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export interface H264Sink { push(p: LiveVideoPacket): void; close(): void; lastFrameAt(): number | null }

export interface H264SinkDeps { readonly onFrame?: (t: number) => void }

/** Decodifica H.264 Annex B com WebCodecs, desenha no canvas e avisa `onFrame` a cada quadro desenhado; sem `VideoDecoder` (browser sem suporte) vira no-op. */
export function createH264Sink(canvas: HTMLCanvasElement, deps: H264SinkDeps = {}): H264Sink {
  if (typeof VideoDecoder === 'undefined') return { push: () => undefined, close: () => undefined, lastFrameAt: () => null };
  const ctx = canvas.getContext('2d');
  let state: SinkState = { configured: false, waitingKey: true, errors: 0, lastSeq: null };
  let decoder: VideoDecoder | null = null; let last: number | null = null; let ts = 0;
  /** `close()` num decoder já fechado (ex.: dentro do callback de erro) lança InvalidStateError. */
  const dispose = () => { try { if (decoder && decoder.state !== 'closed') decoder.close(); } catch { /* já fechado */ } decoder = null; };
  const fail = () => { state = nextAction(state, { error: true }).state; dispose(); };
  const make = () => {
    const d = new VideoDecoder({
      output: (frame) => { try { if (ctx) { if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) { canvas.width = frame.displayWidth; canvas.height = frame.displayHeight; } ctx.drawImage(frame, 0, 0); } last = Date.now(); deps.onFrame?.(last); } finally { frame.close(); } },
      error: fail,
    });
    d.configure({ codec: CODEC, hardwareAcceleration: 'prefer-software', optimizeForLatency: true });
    return d;
  };
  return {
    push: (p) => {
      const r = nextAction(state, { key: p.key, seq: p.seq }); state = r.state;
      if (r.action === 'skip') return;
      if (r.action === 'configure') { dispose(); decoder = make(); }
      try { decoder?.decode(new EncodedVideoChunk({ type: p.key ? 'key' : 'delta', timestamp: ts, data: b64(p.nal) })); ts += 33_333; }
      catch { fail(); }
    },
    close: dispose,
    lastFrameAt: () => last,
  };
}
