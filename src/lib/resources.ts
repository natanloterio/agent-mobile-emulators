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

export function vramEmulatorShare(fleetSize: number): string {
  return pct(((fleetSize * HOST.vramPerEmulatorGB) / HOST.vramTotalGB) * 100);
}
