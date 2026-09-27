import type { MissionView } from '../live/types';

/** Missão de exemplo do modo demo: parada esperando humano depois de um provedor pedir telefone. */
export const DEMO_MISSION: MissionView = {
  id: 'demo-mission', identityId: 'demo', text: 'Crie uma conta de e-mail, use-a para criar uma conta no Instagram e faça login',
  state: 'awaiting-human', humanReason: 'O cadastro do Instagram pediu um captcha', stalled: false, costUsd: 0.38,
  startedAt: '2026-09-27T10:00:00Z', finishedAt: null, current: null,
  subtasks: [
    { seq: 1, objective: 'Criar conta de e-mail no Gmail', state: 'failed', report: { ok: false, did: 'Abriu o cadastro do Google', blockers: 'Pediu número de telefone' }, costUsd: 0.09 },
    { seq: 2, objective: 'Criar conta de e-mail no Outlook', state: 'done', report: { ok: true, did: 'Criou a caixa e guardou o endereço', blockers: '' }, costUsd: 0.12 },
    { seq: 3, objective: 'Cadastrar no Instagram com o e-mail do Outlook', state: 'needs-human', report: { ok: false, did: 'Preencheu nome e e-mail', blockers: 'Captcha' }, costUsd: 0.11 },
  ],
  memory: [
    { key: 'email.address', value: 'enxame.demo.2026@outlook.com', secret: false },
    { key: 'email.inbox', value: 'app Outlook', secret: false },
    { key: 'email.password', value: null, secret: true },
  ],
};
