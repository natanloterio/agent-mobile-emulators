import { describe, expect, it } from 'vitest';
import { createI18n } from '../i18n/translate';
import type { FleetSnapshot, MissionView } from '../live/types';
import { isOpenMission, missionElapsed, missionForIdentity, missionTaskLabel, missionTimeline } from './missionView';

const base: MissionView = {
  id: 'm1', identityId: 'conta2', text: 'crie e-mail e Instagram', state: 'running', humanReason: null, stalled: false, costUsd: 0.42,
  startedAt: '2026-09-27T10:00:00Z', finishedAt: null, current: { seq: 2, objective: 'cadastrar no Instagram' },
  subtasks: [
    { seq: 1, objective: 'criar e-mail', state: 'done', report: { ok: true, did: 'Outlook', blockers: '' }, costUsd: 0.1 },
    { seq: 2, objective: 'cadastrar no Instagram', state: 'running', report: null, costUsd: 0 },
  ],
  memory: [{ key: 'email.address', value: 'x@y.z', secret: false }, { key: 'email.password', value: null, secret: true }],
  notes: [],
};
const snap = (missions: MissionView[]) => ({ identities: [], killed: false, updatedAt: '', missions }) as FleetSnapshot;
const pt = createI18n('pt'); const en = createI18n('en');

describe('missionView', () => {
  it('missão da identidade: a aberta vence a encerrada', () => {
    const old = { ...base, id: 'm0', state: 'done' as const };
    expect(missionForIdentity(snap([old, base]), 'conta2')?.id).toBe('m1');
    expect(missionForIdentity(snap([old]), 'conta2')?.id).toBe('m0');
    expect(missionForIdentity(snap([base]), 'conta9')).toBeNull();
    expect(missionForIdentity(null, 'conta2')).toBeNull();
    expect(isOpenMission(base)).toBe(true); expect(isOpenMission(old)).toBe(false);
  });
  it('rótulo do tile por estado e idioma', () => {
    expect(missionTaskLabel(base, pt)).toBe('Missão · subtarefa 2: cadastrar no Instagram');
    expect(missionTaskLabel({ ...base, current: null }, en)).toBe('Mission · planning the next step');
    expect(missionTaskLabel({ ...base, state: 'awaiting-human', humanReason: 'captcha' }, pt)).toBe('Missão · esperando você: captcha');
    expect(missionTaskLabel({ ...base, state: 'paused', humanReason: 'kill switch' }, pt)).toBe('Missão · pausada: kill switch');
  });
  it('linha do tempo com marcas', () => {
    const rows = missionTimeline({ ...base, subtasks: [...base.subtasks, { seq: 3, objective: 'x', state: 'failed', report: { ok: false, did: 'tentou', blockers: 'telefone' }, costUsd: 0 }, { seq: 4, objective: 'y', state: 'needs-human', report: null, costUsd: 0 }, { seq: 5, objective: 'z', state: 'interrupted', report: null, costUsd: 0 }] });
    expect(rows.map((r) => r.mark)).toEqual(['✓', '…', '✗', '!', '⏸']);
    expect(rows[2]).toMatchObject({ did: 'tentou', blockers: 'telefone' });
  });
  it('tempo decorrido', () => {
    expect(missionElapsed(base, Date.parse('2026-09-27T10:42:00Z'), pt)).toBe('42 min');
    expect(missionElapsed(base, Date.parse('2026-09-27T12:05:00Z'), pt)).toBe('2 h 5 min');
    expect(missionElapsed({ ...base, finishedAt: '2026-09-27T10:10:00Z' }, Date.parse('2026-09-28T00:00:00Z'), pt)).toBe('10 min');
  });
});
