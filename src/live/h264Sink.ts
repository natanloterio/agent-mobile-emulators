import type { LiveVideoPacket } from './types';

export interface SinkState { readonly configured: boolean; readonly waitingKey: boolean; readonly errors: number }
export type SinkAction = 'configure' | 'decode' | 'skip' | 'reset';

/** Máquina de estados pura do decoder (spec inc. 4 §4.3): configura no primeiro key, reseta em erro e espera o próximo key. */
export function nextAction(s: SinkState, p: { key: boolean; error?: boolean }): { action: SinkAction; state: SinkState } {
  if (p.error) return { action: 'reset', state: { configured: false, waitingKey: true, errors: s.errors + 1 } };
  if (s.waitingKey && !p.key) return { action: 'skip', state: s };
  if (!s.configured || (p.key && s.waitingKey)) return { action: 'configure', state: { configured: true, waitingKey: false, errors: s.errors } };
  return { action: 'decode', state: s };
}

const CODEC = 'avc1.42E01E';
const b64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export interface H264Sink { push(p: LiveVideoPacket): void; close(): void; lastFrameAt(): number | null }

/** Decodifica H.264 Annex B com WebCodecs e desenha no canvas; sem `VideoDecoder` (browser sem suporte) vira no-op. */
export function createH264Sink(canvas: HTMLCanvasElement): H264Sink {
  if (typeof VideoDecoder === 'undefined') return { push: () => undefined, close: () => undefined, lastFrameAt: () => null };
  const ctx = canvas.getContext('2d');
  let state: SinkState = { configured: false, waitingKey: true, errors: 0 };
  let decoder: VideoDecoder | null = null; let last: number | null = null; let ts = 0;
  /** `close()` num decoder já fechado (ex.: dentro do callback de erro) lança InvalidStateError. */
  const dispose = () => { try { if (decoder && decoder.state !== 'closed') decoder.close(); } catch { /* já fechado */ } decoder = null; };
  const fail = () => { state = nextAction(state, { key: false, error: true }).state; dispose(); };
  const make = () => {
    const d = new VideoDecoder({
      output: (frame) => { try { if (ctx) { if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) { canvas.width = frame.displayWidth; canvas.height = frame.displayHeight; } ctx.drawImage(frame, 0, 0); } last = Date.now(); } finally { frame.close(); } },
      error: fail,
    });
    d.configure({ codec: CODEC, hardwareAcceleration: 'prefer-software', optimizeForLatency: true });
    return d;
  };
  return {
    push: (p) => {
      const r = nextAction(state, { key: p.key }); state = r.state;
      if (r.action === 'skip') return;
      if (r.action === 'configure') { dispose(); decoder = make(); }
      try { decoder?.decode(new EncodedVideoChunk({ type: p.key ? 'key' : 'delta', timestamp: ts, data: b64(p.nal) })); ts += 33_333; }
      catch { fail(); }
    },
    close: dispose,
    lastFrameAt: () => last,
  };
}
