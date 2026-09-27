import type { LocalRuntimeKind } from '../config.js';

/** Um modelo baixado num runtime local (spec runtimes-locais §Contrato). */
export interface LocalModelEntry {
  readonly id: string; readonly runtime: LocalRuntimeKind; readonly label: string;
  readonly sizeBytes: number | null; readonly loaded: boolean | null; readonly toolUse: boolean | null;
}
export interface RuntimeListing {
  readonly kind: LocalRuntimeKind; readonly label: string; readonly endpoint: string;
  readonly installed: boolean; readonly running: boolean; readonly error: string | null;
  readonly models: readonly LocalModelEntry[];
}
/** Mesmo formato do status do Ollama, para os chamadores não mudarem (worker, líder, teste de provedor). */
export interface RuntimeStatus { readonly running: boolean; readonly spawnedByUs: boolean; readonly adopted: boolean; readonly pid: number | null; readonly models: readonly string[] }

export type Exec = (file: string, args: readonly string[], opts: { timeoutMs: number }) => Promise<{ stdout: string; stderr: string; code: number }>;
