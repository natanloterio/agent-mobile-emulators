import type { HostMetrics } from '../live/types';
import { pct, ptDecimal } from './format';

// Constantes medidas nesta máquina em 2026-09-26 (spec §3). Mudam com o host.
export const HOST = {
  ramTotalGiB: 125.6,
  ramBaselineGiB: 38.3,
  ramPerEmulatorGiB: 4.6,
  threads: 32,
  vcpuPerEmulator: 4,
  vramTotalGB: 32,
  vramPerEmulatorGB: 0.636,
  modelWeightsGiB: 19,
  vramReserveGiB: 3.2,
  ceilingByCpu: 8,
  ceilingByAdb: 16,
} as const;

export interface Meter {
  readonly label: string;
  readonly value: string;
  readonly pct: string;
}

export function hostMeters(fleetSize: number): readonly Meter[] {
  const ram = HOST.ramBaselineGiB + fleetSize * HOST.ramPerEmulatorGiB;
  const vcpu = fleetSize * HOST.vcpuPerEmulator;
  const vram = fleetSize * HOST.vramPerEmulatorGB;
  return [
    { label: 'RAM', value: `${ptDecimal(ram)} / 125 GiB`, pct: pct((ram / HOST.ramTotalGiB) * 100) },
    { label: 'vCPU', value: `${vcpu} / ${HOST.threads}`, pct: pct(Math.min(100, (vcpu / HOST.threads) * 100)) },
    { label: 'VRAM', value: `${ptDecimal(vram)} / ${HOST.vramTotalGB} GB`, pct: pct(((vram + HOST.modelWeightsGiB) / HOST.vramTotalGB) * 100) },
  ];
}

export function kvCacheLeftGiB(fleetSize: number): string {
  const left = HOST.vramTotalGB - HOST.modelWeightsGiB - fleetSize * HOST.vramPerEmulatorGB - HOST.vramReserveGiB;
  return `${ptDecimal(left)} GiB`;
}

export function vramEmulatorShare(fleetSize: number, vramTotalGB: number = HOST.vramTotalGB): string {
  return pct(Math.min(100, ((fleetSize * HOST.vramPerEmulatorGB) / vramTotalGB) * 100));
}

const NO_METER = (label: string): Meter => ({ label, value: '—', pct: '0%' });
const MiB_PER_GiB = 1024;

/** Medidores do host no modo vivo (spec inc. 5 §3.1: `os`, `/proc/stat`, `nvidia-smi`); sem medida → "—". */
export function liveHostMeters(h: HostMetrics | null | undefined): readonly Meter[] {
  if (!h) return [NO_METER('RAM'), NO_METER('CPU'), NO_METER('VRAM')];
  const vram = h.vramUsedMiB !== null && h.vramTotalMiB
    ? { label: 'VRAM', value: `${ptDecimal(h.vramUsedMiB / MiB_PER_GiB)} / ${ptDecimal(h.vramTotalMiB / MiB_PER_GiB)} GB`, pct: pct((h.vramUsedMiB / h.vramTotalMiB) * 100) }
    : NO_METER('VRAM');
  return [
    { label: 'RAM', value: `${ptDecimal(h.ramUsedGiB)} / ${ptDecimal(h.ramTotalGiB)} GiB`, pct: pct(h.ramTotalGiB ? (h.ramUsedGiB / h.ramTotalGiB) * 100 : 0) },
    { label: 'CPU', value: `${Math.round(h.cpuPct)}% · ${h.threads} threads`, pct: pct(Math.min(100, h.cpuPct)) },
    vram,
  ];
}

export interface LiveVram { readonly kvLeft: string; readonly total: string; readonly emuShare: string }

/** VRAM real para a tela Provedores: livre = total − usada; null quando o host não mediu a GPU. */
export function liveVram(h: HostMetrics | null | undefined, fleetSize: number): LiveVram | null {
  if (!h || h.vramUsedMiB === null || !h.vramTotalMiB) return null;
  const totalGB = h.vramTotalMiB / MiB_PER_GiB;
  return {
    kvLeft: `${ptDecimal(Math.max(0, h.vramTotalMiB - h.vramUsedMiB) / MiB_PER_GiB)} GiB`,
    total: `${Math.round(totalGB)} GB`,
    emuShare: vramEmulatorShare(fleetSize, totalGB),
  };
}
