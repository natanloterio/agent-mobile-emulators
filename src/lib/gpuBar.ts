import { PT, type I18n } from '../i18n/translate';
import type { GpuBreakdown, GpuSlice } from '../live/types';

export type GpuSegKind = GpuSlice['kind'] | 'free';

/** Um pedaço da barra de VRAM e sua linha na legenda. `gb` sem unidade; `width` em % do total. */
export interface GpuSegment {
  readonly key: string; readonly kind: GpuSegKind; readonly label: string; readonly gb: string;
  readonly width: string; readonly inBar: boolean; readonly tone: number;
}
export interface GpuBarView { readonly total: string; readonly free: string; readonly segments: readonly GpuSegment[] }

const MiB_PER_GiB = 1024;
/** Abaixo disso (em % da largura) a fatia fica só na legenda: não cabe texto dentro. */
const MIN_TEXT_PCT = 1.5;
/** Quantos verdes distintos existem para modelos (o CSS define um por índice). */
export const MODEL_TONES = 3;
const ORDER: readonly GpuSlice['kind'][] = ['model', 'emulators', 'other'];

/** Barra empilhada da VRAM medida: modelos, emuladores, outros e livre; null sem medida. */
export function gpuBar(g: GpuBreakdown | null | undefined, i18n: I18n = PT): GpuBarView | null {
  if (!g || !(g.totalMiB > 0)) return null;
  const gb = (mib: number) => i18n.fmt.decimal(mib / MiB_PER_GiB);
  const freeMiB = Math.max(0, g.totalMiB - g.usedMiB);
  const sorted = ORDER.flatMap((k) => g.slices.filter((s) => s.kind === k));
  const labelOf = (s: GpuSlice) =>
    s.kind === 'model' ? s.label : i18n.t(s.kind === 'emulators' ? 'providers.vram.emu' : 'providers.vram.other');
  const items = [
    ...sorted.map((s, i) => ({ key: `${s.kind}:${s.label}:${i}`, kind: s.kind as GpuSegKind, label: labelOf(s), mib: s.usedMiB })),
    { key: 'free', kind: 'free' as GpuSegKind, label: i18n.t('providers.vram.freeLabel'), mib: freeMiB },
  ];
  // Cada fatia só ocupa o que sobra da largura: a soma nunca passa de 100 %.
  const { segments } = items.reduce<{ left: number; models: number; segments: readonly GpuSegment[] }>((acc, it) => {
    const raw = Math.max(0, (it.mib / g.totalMiB) * 100);
    const w = Math.floor(Math.min(raw, acc.left) * 100) / 100;
    const tone = it.kind === 'model' ? acc.models % MODEL_TONES : 0;
    const seg: GpuSegment = { key: it.key, kind: it.kind, label: it.label, gb: gb(Math.max(0, it.mib)), width: `${w.toFixed(2)}%`, inBar: w >= MIN_TEXT_PCT, tone };
    return { left: acc.left - w, models: acc.models + (it.kind === 'model' ? 1 : 0), segments: [...acc.segments, seg] };
  }, { left: 100, models: 0, segments: [] });
  return { total: gb(g.totalMiB), free: gb(freeMiB), segments };
}
