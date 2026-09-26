import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { phoneLabel } from '../live/frameAge';
import { createH264Sink } from '../live/h264Sink';
import type { InputGesture } from '../live/types';
import { useControlSurface } from '../live/useControlSurface';
import { useNow } from '../live/useNow';
import type { VideoBus } from '../live/videoBus';
import type { Identity } from '../types/fleet';
import './PhoneMock.css';

interface Row { readonly a: string; readonly b: string }
const TILE_ROWS: readonly Row[] = [{ a: '80%', b: '55%' }, { a: '70%', b: '40%' }];
const FULL_ROWS: readonly Row[] = [{ a: '70%', b: '45%' }, { a: '85%', b: '30%' }, { a: '60%', b: '50%' }, { a: '75%', b: '35%' }];
/** Intervalo mínimo entre atualizações de estado da idade do vídeo: o canvas roda a 30 fps, o React não. */
const VIDEO_AT_THROTTLE_MS = 500;

interface PhoneMockProps {
  readonly handle: string;
  readonly streamLabel: string;
  readonly variant: 'tile' | 'full';
  readonly overlay?: string;
  readonly draft?: string;
  readonly controlled?: boolean;
  readonly maxHeight?: string;
  readonly videoId?: string;
  readonly bus?: VideoBus | null;
  readonly screen?: { readonly dataUrl: string; readonly at: string };
  readonly video?: Identity['video'];
  /** Modo controle (spec inc. 5): com `controlled`, toque/arraste/teclado na tela e os botões viram gestos. */
  readonly onInput?: (g: InputGesture) => void;
}

const NAV_KEYS = [
  { key: 'back', label: 'device.phone.back' }, { key: 'home', label: 'device.phone.home' }, { key: 'recents', label: 'device.phone.recents' },
] as const;

/** Esqueleto da tela (sem dados vivos), mantido idêntico ao anterior. */
function Skeleton({ variant }: { readonly variant: 'tile' | 'full' }) {
  const rows = variant === 'tile' ? TILE_ROWS : FULL_ROWS;
  return (
    <>
      <div className="phone__block phone__block--top" />
      {rows.slice(0, variant === 'tile' ? 1 : rows.length).map((r, i) => (
        <div className="phone__row" key={i}>
          <div className="phone__avatar" />
          <div className="phone__lines">
            <div className="phone__line" style={{ width: r.a }} />
            <div className="phone__line" style={{ width: r.b }} />
          </div>
        </div>
      ))}
      <div className="phone__block phone__block--fill" />
      {variant === 'tile' && (
        <div className="phone__row">
          <div className="phone__avatar" />
          <div className="phone__lines">
            <div className="phone__line" style={{ width: '70%' }} />
            <div className="phone__line" style={{ width: '40%' }} />
          </div>
        </div>
      )}
    </>
  );
}

/** Tela de celular: vídeo ao vivo (WebCodecs) quando há pacotes, senão o poster PNG, senão o esqueleto. */
export function PhoneMock({ handle, streamLabel, variant, overlay, draft, controlled = false, maxHeight, videoId, bus, screen, video, onInput }: PhoneMockProps) {
  const cls = ['phone', `phone--${variant}`, controlled ? 'phone--controlled' : ''].filter(Boolean).join(' ');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [videoAt, setVideoAt] = useState<number | null>(null);
  const lastSetRef = useRef<number | null>(null);
  const now = useNow(1000);
  const i18n = useI18n();
  const { t } = i18n;
  useEffect(() => {
    const canvas = canvasRef.current; if (!videoId || !bus || !canvas) return;
    // Chamado pelo `output` do decoder (assíncrono); só re-renderiza a cada ≥ 500 ms, nunca a 30 fps.
    const onFrame = (t: number) => {
      const prev = lastSetRef.current;
      if (prev !== null && t - prev < VIDEO_AT_THROTTLE_MS) return;
      lastSetRef.current = t; setVideoAt(t);
    };
    const sink = createH264Sink(canvas, { onFrame });
    const off = bus.subscribe(videoId, (p) => sink.push(p));
    return () => { off(); sink.close(); lastSetRef.current = null; setVideoAt(null); };
  }, [videoId, bus]);
  const hasVideo = videoAt !== null;
  const interactive = controlled && !!onInput;
  const surface = useControlSurface(interactive, onInput);
  const surfaceCls = interactive ? ' phone__surface--control' : '';
  const surfaceLabel = interactive ? t('device.phone.controlSurface', { handle }) : undefined;
  const label = phoneLabel({ video, videoAt, screenAt: screen?.at, now, fallback: streamLabel, i18n });
  return (
    <div className={cls} style={maxHeight ? { maxHeight } : undefined}>
      <div className="phone__meta"><span>{handle}</span><span>{label}</span></div>
      {videoId && bus && <canvas ref={canvasRef} className={`phone__video${hasVideo ? surfaceCls : ''}`} style={{ display: hasVideo ? 'block' : 'none' }} aria-label={(hasVideo && surfaceLabel) || t('device.phone.video', { handle })} {...(hasVideo ? surface : {})} />}
      {!hasVideo && screen && <img className={`phone__screen${surfaceCls}`} src={screen.dataUrl} alt={surfaceLabel ?? t('device.phone.screen', { handle })} draggable={false} {...surface} />}
      {!hasVideo && !screen && <Skeleton variant={variant} />}
      {interactive && onInput && (
        <div className="phone__nav" role="group" aria-label={t('device.phone.keys')}>
          {NAV_KEYS.map((k) => <button key={k.key} type="button" className="phone__nav-btn" onClick={() => onInput({ kind: 'key', key: k.key })}>{t(k.label)}</button>)}
        </div>
      )}
      {variant === 'full' && draft && <div className="phone__draft">{draft}</div>}
      {overlay && <div className="phone__overlay">{overlay}</div>}
    </div>
  );
}
