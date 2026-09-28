import type { BaseAvdStatus } from '../live/types';

export type BaseStage = 'missing' | 'running' | 'ready';

/** Estágio do celular-base; `null` quando não há o que mostrar (sem dado do daemon, ou base pronta e frota já criada). */
export function baseStage(base: BaseAvdStatus | null | undefined, hasIdentities: boolean): BaseStage | null {
  if (!base) return null;
  if (!base.found) return 'missing';
  if (base.running) return 'running';
  return hasIdentities ? null : 'ready';
}

/** Provisionar só com a base existente e desligada (clone de disco em uso sai inconsistente). */
export const baseBlocksProvision = (stage: BaseStage | null): boolean => stage === 'missing' || stage === 'running';
