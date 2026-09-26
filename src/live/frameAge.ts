import type { VideoStreamState } from '../types/fleet';

const LIVE_LABEL = 'vídeo · ao vivo';

/** Rótulo de idade do quadro exibido: vídeo ao vivo (< 2 s), segundos ou minutos. */
export function frameAgeLabel(at: string | number, nowMs: number): string {
  const t = typeof at === 'number' ? at : Date.parse(at);
  if (Number.isNaN(t)) return 'vídeo';
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 2) return LIVE_LABEL;
  if (s < 60) return `há ${s} s`;
  return `há ${Math.floor(s / 60)} min`;
}

export interface PhoneLabelInput {
  readonly video?: VideoStreamState; readonly videoAt: number | null; readonly screenAt?: string;
  readonly now: number; readonly fallback: string;
}

/**
 * Rótulo da tela: "ao vivo" vem do estado do stream no daemon (tela parada não gera pacote, spec inc. 4 §4);
 * fora disso, a idade do último quadro decodificado ou do poster; sem nada, o rótulo padrão do tile.
 */
export function phoneLabel({ video, videoAt, screenAt, now, fallback }: PhoneLabelInput): string {
  if (video === 'streaming') return LIVE_LABEL;
  if (videoAt !== null) return frameAgeLabel(videoAt, now);
  if (screenAt !== undefined) return frameAgeLabel(screenAt, now);
  return fallback;
}
