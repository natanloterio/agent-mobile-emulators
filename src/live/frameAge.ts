import { PT, type I18n } from '../i18n/translate';
import type { VideoStreamState } from '../types/fleet';

/** Rótulo de idade do quadro exibido: vídeo ao vivo (< 2 s), segundos ou minutos. */
export function frameAgeLabel(at: string | number, nowMs: number, i18n: I18n = PT): string {
  const { t } = i18n;
  const ms = typeof at === 'number' ? at : Date.parse(at);
  if (Number.isNaN(ms)) return t('common.video.generic');
  const s = Math.max(0, Math.round((nowMs - ms) / 1000));
  if (s < 2) return t('common.video.live');
  if (s < 60) return t('common.video.agoSec', { n: s });
  return t('common.video.agoMin', { n: Math.floor(s / 60) });
}

export interface PhoneLabelInput {
  readonly video?: VideoStreamState; readonly videoAt: number | null; readonly screenAt?: string;
  readonly now: number; readonly fallback: string; readonly i18n?: I18n;
}

/**
 * Rótulo da tela: "ao vivo" exige tanto o estado `streaming` do daemon quanto um quadro já decodificado
 * (sem quadro decodificado, streaming ainda não desenhou nada no canvas — mostra a idade do que existe);
 * fora disso, a idade do último quadro decodificado ou do poster; sem nada, o rótulo padrão do tile.
 */
export function phoneLabel({ video, videoAt, screenAt, now, fallback, i18n = PT }: PhoneLabelInput): string {
  if (video === 'streaming' && videoAt !== null) return i18n.t('common.video.live');
  if (videoAt !== null) return frameAgeLabel(videoAt, now, i18n);
  if (screenAt !== undefined) return frameAgeLabel(screenAt, now, i18n);
  return fallback;
}
