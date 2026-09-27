import type { ModelMessage } from 'ai';
import type { SubtaskReport } from '../db/missions.js';

/** Tools liberadas no pedido final da missão (spec missões §Executor): só fechar a subtarefa ou pedir humano. */
export const MISSION_FINISH_TOOLS = ['finish_subtask', 'request_human'] as const;
/** Passos no máximo do pedido final: é um empurrão para fechar, não uma nova tentativa da subtarefa. */
export const MISSION_FINISH_STEPS = 2;

/**
 * Se o executor deve receber o pedido final antes de a subtarefa falhar (spec missões §Executor): terminou sem
 * finish_subtask, sem halt nem parada (kill/pausa) e com orçamento de passos de sobra (ou desligado, `null`).
 */
export function shouldRunMissionFinish(i: {
  readonly mission: boolean; readonly report: SubtaskReport | null; readonly halted: boolean; readonly stopped: boolean;
  readonly budget: number | null; readonly stepsUsed: number;
}): boolean {
  return i.mission && i.report === null && !i.halted && !i.stopped && (i.budget === null || i.stepsUsed < i.budget);
}

/** Mensagens do segmento de fechamento: a conversa até aqui (histórico + resposta do último segmento) + o pedido. */
export function buildMissionFinishMessages(history: readonly ModelMessage[], responseMessages: readonly ModelMessage[], nudge: string): ModelMessage[] {
  return [...history, ...responseMessages, { role: 'user', content: nudge }];
}
