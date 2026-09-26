import { CONFIG } from '../config.js';
import type { Adb } from './adb.js';

export interface Frame { readonly id: string; readonly at: string; readonly png: string }
export interface ScreenTarget { readonly id: string; readonly serial: string }
export interface ScreenCapture {
  start(targets: readonly ScreenTarget[]): void;
  stop(): void;
  last(id: string): Frame | null;
  all(): readonly Frame[];
  onFrame(cb: (f: Frame) => void): () => void;
  setActive(active: boolean): void;
}
export interface ScreenDeps {
  readonly adb: Pick<Adb, 'screencap'>;
  readonly intervalMs?: number; readonly retryMs?: number;
  readonly sleep?: (ms: number) => Promise<void>; readonly now?: () => Date;
}

const IDLE_POLL_MS = 250;

/** Spec inc. 4 §4.1: um loop por identidade, último quadro em memória, captura só com alguém assistindo. */
export function createScreenCapture(deps: ScreenDeps): ScreenCapture {
  const intervalMs = deps.intervalMs ?? CONFIG.screen.intervalMs;
  const retryMs = deps.retryMs ?? CONFIG.screen.retryMs;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? (() => new Date());
  const frames = new Map<string, Frame>();
  const listeners = new Set<(f: Frame) => void>();
  let active = false;
  let generation = 0;

  const captureOnce = async (t: ScreenTarget, gen: number): Promise<number> => {
    let png: Buffer;
    try {
      png = await deps.adb.screencap(t.serial);
    } catch { return retryMs; } // device ausente ou adb falhou: mantém o último quadro
    if (gen !== generation) return intervalMs; // stop()/start() ocorreu com a captura em voo: descarta o quadro atrasado
    const frame: Frame = { id: t.id, at: now().toISOString(), png: png.toString('base64') };
    frames.set(t.id, frame);
    for (const cb of listeners) {
      try { cb(frame); } catch (e) { console.error('[screen] listener falhou:', e); }
    }
    return intervalMs;
  };

  const loop = async (t: ScreenTarget, gen: number): Promise<void> => {
    while (gen === generation) {
      if (!active) { await sleep(IDLE_POLL_MS); continue; }
      const wait = await captureOnce(t, gen);
      if (gen !== generation) return;
      await sleep(wait);
    }
  };

  return {
    start: (targets) => { generation += 1; frames.clear(); for (const t of targets) void loop(t, generation); },
    stop: () => { generation += 1; frames.clear(); },
    last: (id) => frames.get(id) ?? null,
    all: () => [...frames.values()],
    onFrame: (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    setActive: (a) => { active = a; },
  };
}
