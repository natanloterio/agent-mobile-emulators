/** DTOs do onboarding trocados com o renderer. O renderer valida o mesmo formato em src/onboarding/schema.ts. */
export type DepId = 'node' | 'sdk' | 'adb' | 'emu' | 'img' | 'kvm' | 'ollama' | 'keyring';
export type DepState = 'ok' | 'todo' | 'user';
/** O que a pessoa precisa fazer quando não dá para instalar sozinho. */
export type UserFix = 'node-missing' | 'kvm-group' | 'kvm-bios' | 'keyring-locked';
export interface DepStatus {
  readonly id: DepId;
  readonly state: DepState;
  readonly version: string | null;
  /** Download estimado em MB (só em `todo`). */
  readonly sizeMb: number | null;
  readonly fix: UserFix | null;
}
export interface Hardware {
  readonly ramGiB: number;
  readonly threads: number;
  readonly cpuModel: string;
  readonly gpu: { readonly name: string; readonly totalGiB: number } | null;
  readonly diskFreeGiB: number;
}
export interface SetupReport {
  readonly deps: readonly DepStatus[];
  readonly hardware: Hardware;
  /** Modelos do Ollama já no disco, `nome:tag`. */
  readonly localModels: readonly string[];
}
export type JobId = 'sdk' | 'adb' | 'emu' | 'img' | 'ollama' | 'model';
/** Ordem de instalação: o sdkmanager vem antes dos pacotes; o Ollama antes do modelo. */
export const JOB_ORDER: readonly JobId[] = ['sdk', 'adb', 'emu', 'img', 'ollama', 'model'];
export type JobState = 'wait' | 'run' | 'done' | 'err';
export interface JobEvent {
  readonly id: JobId;
  readonly state: JobState;
  readonly doneMb: number;
  readonly totalMb: number;
  readonly error: { readonly kind: 'disk-full' | 'network' | 'checksum' | 'process'; readonly message: string } | null;
}
export type SetupMode = 'misto' | 'local' | 'nuvem';
