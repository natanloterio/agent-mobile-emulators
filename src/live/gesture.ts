import type { InputGesture } from './types';

/**
 * Gestos do modo controle (spec inc. 5 §3.3), puros: ponteiro → tap/swipe em coordenadas 0–1 da tela do device,
 * teclado → text/key. O componente só coleta eventos e chama estas funções.
 */

export interface Size { readonly width: number; readonly height: number }
export interface Point { readonly x: number; readonly y: number }
export interface Rect extends Point, Size {}
export interface Sample extends Point { readonly t: number }

/** Espelha o CSS de `.phone__video`/`.phone__screen`: `object-fit: contain; object-position: top center`. */
export const OBJECT_POSITION: Point = { x: 0.5, y: 0 };
export const TAP_MAX_MOVE = 0.02;
export const TAP_MAX_MS = 300;
export const SWIPE_MS = { min: 1, max: 5000 } as const;
export const TEXT_DEBOUNCE_MS = 250;
export const MAX_TEXT = 500;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Área onde o vídeo é de fato desenhado dentro do elemento (o resto é faixa preta do letterbox). */
export function contentRect(box: Size, content: Size, align: Point = OBJECT_POSITION): Rect {
  if (content.width <= 0 || content.height <= 0) return { x: 0, y: 0, width: box.width, height: box.height };
  const s = Math.min(box.width / content.width, box.height / content.height);
  const width = content.width * s; const height = content.height * s;
  return { x: (box.width - width) * align.x, y: (box.height - height) * align.y, width, height };
}

/**
 * Ponto relativo ao elemento → 0–1 sobre a tela do device. Fora da área útil devolve null
 * (toque na faixa preta não vira toque na borda), a menos que `clamp` (fim de arraste que saiu da tela).
 */
export function toNormalized(p: Point, box: Size, content: Size, opts: { clamp?: boolean; align?: Point } = {}): Point | null {
  const r = contentRect(box, content, opts.align);
  if (r.width <= 0 || r.height <= 0) return null;
  const x = (p.x - r.x) / r.width; const y = (p.y - r.y) / r.height;
  if (opts.clamp) return { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
  return x < 0 || x > 1 || y < 0 || y > 1 ? null : { x, y };
}

/** Pouco movimento (< 2% da tela) e rápido (< 300 ms) → tap; senão swipe com a duração real (toque longo = swipe parado). */
export function classifyGesture(down: Sample, up: Sample): InputGesture {
  const ms = up.t - down.t;
  if (Math.hypot(up.x - down.x, up.y - down.y) < TAP_MAX_MOVE && ms < TAP_MAX_MS) return { kind: 'tap', x: down.x, y: down.y };
  return { kind: 'swipe', x: down.x, y: down.y, x2: up.x, y2: up.y, durationMs: Math.round(clamp(ms, SWIPE_MS.min, SWIPE_MS.max)) };
}

export interface Clock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}
export interface KeyLike { readonly key: string; readonly ctrlKey?: boolean; readonly metaKey?: boolean; readonly altKey?: boolean }
export interface KeyCollector {
  /** Trata a tecla; `true` = consumida (o componente dá preventDefault). */
  key(e: KeyLike): boolean;
  flush(): void;
  /** Cancela o timer e descarta o texto pendente. */
  dispose(): void;
}

const SPECIAL: Readonly<Record<string, 'del' | 'enter' | 'back'>> = { Backspace: 'del', Enter: 'enter', Escape: 'back' };
const isAscii = (ch: string) => ch >= ' ' && ch <= '~';

/**
 * Junta teclas imprimíveis num só `text` depois de `delayMs` sem digitação; teclas especiais esvaziam o pendente
 * antes (ordem preservada). Caractere fora do ASCII sai sozinho: o daemon recusa só ele, sem perder o texto ao redor.
 */
export function createKeyCollector(emit: (g: InputGesture) => void, clock: Clock, delayMs = TEXT_DEBOUNCE_MS): KeyCollector {
  let buf = ''; let timer: unknown = null;
  const stop = () => { if (timer !== null) { clock.clearTimeout(timer); timer = null; } };
  const flush = () => { stop(); if (buf) { const text = buf; buf = ''; emit({ kind: 'text', text }); } };
  return {
    key: (e) => {
      if (e.ctrlKey || e.metaKey) return false;
      const special = SPECIAL[e.key];
      if (special) { flush(); emit({ kind: 'key', key: special }); return true; }
      if ([...e.key].length !== 1) return false;
      if (!isAscii(e.key)) { flush(); emit({ kind: 'text', text: e.key }); return true; }
      buf += e.key;
      if (buf.length >= MAX_TEXT) { flush(); return true; }
      stop(); timer = clock.setTimeout(flush, delayMs);
      return true;
    },
    flush,
    dispose: () => { stop(); buf = ''; },
  };
}
