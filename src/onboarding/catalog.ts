import type { MessageKey } from '../i18n/messages';

export type SetupMode = 'misto' | 'local' | 'nuvem';
export const MODES: readonly SetupMode[] = ['misto', 'local', 'nuvem'];
export type RoleWhere = 'cloud' | 'local';
/** Onde cada papel (líder, agentes, escalada) roda em cada modo; igual a electron/setup/apply.ts. */
export const MODE_ROLES: Readonly<Record<SetupMode, readonly [RoleWhere, RoleWhere, RoleWhere]>> = {
  misto: ['cloud', 'local', 'cloud'], local: ['local', 'local', 'local'], nuvem: ['cloud', 'cloud', 'cloud'],
};

export interface ModelEntry { readonly id: string; readonly sizeGb: number; readonly vramGb: number; readonly noteKey: MessageKey; readonly recommended?: boolean }
/** Tamanhos do registro do Ollama; memória de vídeo estimada com o contexto padrão do Enxame (65536). */
export const LOCAL_MODELS: readonly ModelEntry[] = [
  { id: 'gpt-oss:20b', sizeGb: 14, vramGb: 16, noteKey: 'onboarding.model.note.gptoss20', recommended: true },
  { id: 'qwen3:14b', sizeGb: 9.3, vramGb: 13, noteKey: 'onboarding.model.note.qwen14' },
  { id: 'qwen3:32b', sizeGb: 20, vramGb: 24, noteKey: 'onboarding.model.note.qwen32' },
  { id: 'gpt-oss:120b', sizeGb: 65, vramGb: 68, noteKey: 'onboarding.model.note.gptoss120' },
];
export const VRAM_SYSTEM_GIB = 1.2;
/** Mesmos números de src/lib/resources.ts (HOST.ramPerEmulatorGiB, HOST.vcpuPerEmulator). */
export const RAM_PER_EMULATOR_GIB = 4.6;
export const THREADS_PER_EMULATOR = 4;
