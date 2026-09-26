import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { classifyGesture, createKeyCollector, toNormalized, type KeyCollector, type Sample, type Size } from './gesture';
import type { InputGesture } from './types';

/** Tamanho intrínseco do que está desenhado: canvas do vídeo (quadro decodificado) ou poster PNG. */
function intrinsicSize(el: Element): Size {
  if (el instanceof HTMLCanvasElement) return { width: el.width, height: el.height };
  if (el instanceof HTMLImageElement) return { width: el.naturalWidth, height: el.naturalHeight };
  return { width: 0, height: 0 };
}

/** Ponto do evento relativo ao elemento, em 0–1 da tela do device (respeita o letterbox do `object-fit`). */
function sample(e: PointerEvent<Element>, clamp: boolean): Sample | null {
  const r = e.currentTarget.getBoundingClientRect();
  const p = toNormalized({ x: e.clientX - r.left, y: e.clientY - r.top }, { width: r.width, height: r.height }, intrinsicSize(e.currentTarget), { clamp });
  return p ? { ...p, t: e.timeStamp } : null;
}

export interface ControlSurfaceProps {
  readonly tabIndex?: number;
  readonly onPointerDown?: (e: PointerEvent<Element>) => void;
  readonly onPointerUp?: (e: PointerEvent<Element>) => void;
  readonly onPointerCancel?: () => void;
  readonly onKeyDown?: (e: KeyboardEvent<Element>) => void;
  readonly onBlur?: () => void;
}

/**
 * Props para a superfície da tela no modo controle: ponteiro → tap/swipe, teclado → text/key (spec inc. 5 §3.3).
 * Desligado, devolve `{}` e a superfície fica só de leitura.
 */
export function useControlSurface(enabled: boolean, onInput?: (g: InputGesture) => void): ControlSurfaceProps {
  const onInputRef = useRef(onInput);
  useEffect(() => { onInputRef.current = onInput; }, [onInput]);
  const downRef = useRef<{ readonly id: number; readonly at: Sample } | null>(null);
  const keysRef = useRef<KeyCollector | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const keys = createKeyCollector((g) => onInputRef.current?.(g), {
      setTimeout: (fn, ms) => window.setTimeout(fn, ms), clearTimeout: (id) => window.clearTimeout(id as number),
    });
    keysRef.current = keys;
    // Controle desligado/desmontado: texto pendente é descartado (o daemon responderia 409).
    return () => { keys.dispose(); keysRef.current = null; downRef.current = null; };
  }, [enabled]);
  if (!enabled) return {};
  return {
    tabIndex: 0,
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); (e.currentTarget as HTMLElement).focus();
      const at = sample(e, false); if (!at) return; // toque na faixa preta do letterbox
      e.currentTarget.setPointerCapture?.(e.pointerId);
      downRef.current = { id: e.pointerId, at };
    },
    onPointerUp: (e) => {
      const down = downRef.current; downRef.current = null;
      if (!down || down.id !== e.pointerId) return;
      const up = sample(e, true); if (!up) return;
      onInputRef.current?.(classifyGesture(down.at, up));
    },
    onPointerCancel: () => { downRef.current = null; },
    onKeyDown: (e) => {
      if (keysRef.current?.key(e)) e.preventDefault();
    },
    onBlur: () => keysRef.current?.flush(),
  };
}
