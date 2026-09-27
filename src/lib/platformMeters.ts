import { PT, type I18n } from '../i18n/translate';
import type { HostMetrics } from '../live/types';
import { pct } from './format';
import type { Meter } from './resources';

// Recursos do host por sistema operacional: cada SO mostra só o que o daemon consegue medir nele.

export type HostOs = 'linux' | 'mac' | 'windows';
type Host = HostMetrics | null | undefined;

const MiB_PER_GiB = 1024;
const NO_METER = (label: string): Meter => ({ label, value: '—', pct: '0%' });

/** Visão de recursos pelo `process.platform` do daemon; daemon antigo (sem o campo) ou SO desconhecido → Linux. */
export function hostOs(h: Host): HostOs {
  if (h?.platform === 'darwin') return 'mac';
  if (h?.platform === 'win32') return 'windows';
  return 'linux';
}

/** Mac com chip Apple: memória unificada, a GPU (e os modelos locais) usam a mesma RAM. */
export const isAppleSilicon = (h: Host): boolean => h?.platform === 'darwin' && h.arch === 'arm64';

const ramMeter = (h: HostMetrics, i18n: I18n): Meter => ({
  label: 'RAM',
  value: `${i18n.fmt.decimal(h.ramUsedGiB)} / ${i18n.fmt.decimal(h.ramTotalGiB)} GiB`,
  pct: pct(h.ramTotalGiB ? (h.ramUsedGiB / h.ramTotalGiB) * 100 : 0),
});

const cpuMeter = (h: HostMetrics, i18n: I18n): Meter => ({
  label: 'CPU',
  value: i18n.t('shell.meters.cpuValue', { pct: `${Math.round(h.cpuPct)}%`, threads: h.threads }),
  pct: pct(Math.min(100, h.cpuPct)),
});

/** VRAM medida pelo nvidia-smi; null quando o host não tem GPU mensurável. */
function vramMeter(h: HostMetrics, i18n: I18n): Meter | null {
  if (h.vramUsedMiB === null || !h.vramTotalMiB) return null;
  const gb = (mib: number) => i18n.fmt.decimal(mib / MiB_PER_GiB);
  return { label: 'VRAM', value: `${gb(h.vramUsedMiB)} / ${gb(h.vramTotalMiB)} GB`, pct: pct((h.vramUsedMiB / h.vramTotalMiB) * 100) };
}

const withGpu = (h: HostMetrics, i18n: I18n): readonly Meter[] => {
  const vram = vramMeter(h, i18n);
  return vram ? [ramMeter(h, i18n), cpuMeter(h, i18n), vram] : [ramMeter(h, i18n), cpuMeter(h, i18n)];
};

/** Linux: /proc para RAM e CPU; VRAM só com NVIDIA. */
export const linuxMeters = withGpu;
/** Windows: RAM e CPU pelo `os`; VRAM só com NVIDIA (nvidia-smi vem com o driver). */
export const windowsMeters = withGpu;
/** macOS: RAM e CPU pelo `os`; nunca VRAM (sem nvidia-smi; no Apple Silicon ela é a própria RAM). */
export const macMeters = (h: HostMetrics, i18n: I18n): readonly Meter[] => [ramMeter(h, i18n), cpuMeter(h, i18n)];

const BY_OS: Readonly<Record<HostOs, (h: HostMetrics, i18n: I18n) => readonly Meter[]>> = {
  linux: linuxMeters, windows: windowsMeters, mac: macMeters,
};

/** Medidores do modo vivo. Sem amostra ainda: os três em "—" (conectando); depois, só o que o SO mede. */
export function metersFor(h: Host, i18n: I18n = PT): readonly Meter[] {
  if (!h) return [NO_METER('RAM'), NO_METER('CPU'), NO_METER('VRAM')];
  return BY_OS[hostOs(h)](h, i18n);
}

/** Provedores mostra o quadro da VRAM? Até a 1ª amostra, sim; depois, só se a VRAM foi medida fora do macOS. */
export function vramMeasured(h: Host): boolean {
  if (!h) return true;
  return hostOs(h) !== 'mac' && h.vramUsedMiB !== null && !!h.vramTotalMiB;
}
