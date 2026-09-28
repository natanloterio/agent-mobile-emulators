import type { BaseAvdStatus } from '../live/types';

/** `preparing`: o preparo automático está em andamento, parado esperando alguém, ou falhou (retomável). */
export type BaseStage = 'missing' | 'preparing' | 'running';

const ACTIVE_PREP = new Set(['running', 'needs-google', 'needs-human', 'failed']);

/** Estágio do celular-base; `null` quando está pronto (ou sem dado do daemon). */
export function baseStage(base: BaseAvdStatus | null | undefined): BaseStage | null {
  if (!base) return null;
  if (base.prep && ACTIVE_PREP.has(base.prep.state)) return 'preparing';
  if (!base.found) return 'missing';
  // Ligada por fora do preparo: o clone de um disco em uso sai inconsistente.
  if (base.running) return 'running';
  return null;
}

/** Provisionar só com a base pronta e desligada. */
export const baseBlocksProvision = (stage: BaseStage | null): boolean => stage !== null;
