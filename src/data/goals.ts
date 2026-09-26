import type { PastGoal } from '../types/fleet';

export const CURRENT_GOAL_TEXT = 'Responder comentários das últimas 24 h nas contas das lojas';
export const DEFAULT_GOAL_TEXT = 'Responder comentários das últimas 24 h em todas as contas';

export const GOAL_EXAMPLES: readonly string[] = [
  'Responder comentários das últimas 24 h',
  'Curtir respostas em stories',
  'Levantar DMs sem resposta',
];

export const TASK_INSTRUCTION = 'Responder comentários da própria caixa, últimas 24 h';

export const PAST_GOALS: readonly PastGoal[] = [
  { text: 'Responder comentários do fim de semana', pattern: 'fan-out', result: '8/8 · 142 respostas', cost: 'US$ 4,10' },
  { text: 'Curtir respostas em stories da campanha', pattern: 'fan-out', result: '7/8 · 1 checkpoint', cost: 'US$ 2,85' },
  { text: 'Revisar fila de 300 menções', pattern: 'sharding', result: '300/300', cost: 'US$ 6,02' },
];
