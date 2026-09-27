import { PT, type I18n } from '../i18n/translate';
import type { MissionView } from '../live/types';

/** Missão de exemplo do modo demo: parada esperando humano depois de um provedor pedir telefone. */
export function demoMission(i18n: I18n = PT): MissionView {
  const { t } = i18n;
  return {
    id: 'demo-mission', identityId: 'demo', text: t('mission.demo.text'),
    state: 'awaiting-human', humanReason: t('mission.demo.humanReason'), stalled: false, costUsd: 0.38,
    startedAt: '2026-09-27T10:00:00Z', finishedAt: null, current: null,
    subtasks: [
      { seq: 1, objective: t('mission.demo.sub1.objective'), state: 'failed', report: { ok: false, did: t('mission.demo.sub1.did'), blockers: t('mission.demo.sub1.blockers') }, costUsd: 0.09 },
      { seq: 2, objective: t('mission.demo.sub2.objective'), state: 'done', report: { ok: true, did: t('mission.demo.sub2.did'), blockers: '' }, costUsd: 0.12 },
      { seq: 3, objective: t('mission.demo.sub3.objective'), state: 'needs-human', report: { ok: false, did: t('mission.demo.sub3.did'), blockers: t('mission.demo.sub3.blockers') }, costUsd: 0.11 },
    ],
    memory: [
      { key: 'email.address', value: 'enxame.demo.2026@outlook.com', secret: false },
      { key: 'email.inbox', value: t('mission.demo.mem.inbox'), secret: false },
      { key: 'email.password', value: null, secret: true },
    ],
  };
}
