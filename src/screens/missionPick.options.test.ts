import { describe, expect, it } from 'vitest';
import { PT } from '../i18n/translate';
import type { FleetSnapshot, LiveIdentity, MissionView } from '../live/types';
import { missionOptions, replacedNames } from './missionPick';

const idn = (id: string, extra: Partial<LiveIdentity> = {}) => ({ id, name: id, handle: `@${id}`, state: 'idle', task: '', steps: 0, budget: 60, costUsd: 0, error: '', lastTools: [], ...extra }) as LiveIdentity;
const mis = (identityId: string, state: MissionView['state']) => ({ id: `m-${identityId}`, identityId, state }) as MissionView;
const snap = (identities: LiveIdentity[], missions: MissionView[]) => ({ identities, missions, killed: false, updatedAt: '' }) as FleetSnapshot;

describe('opções do composer de missão', () => {
  it('missão parada deixa escolher e avisa que substitui; rodando bloqueia', () => {
    const o = missionOptions(snap([idn('conta1'), idn('conta2'), idn('conta3'), idn('conta4')], [mis('conta2', 'paused'), mis('conta3', 'running'), mis('conta4', 'awaiting-human')]), PT);
    expect(o.map((x) => [x.id, x.disabled, !!x.replaces])).toEqual([['conta1', false, false], ['conta2', false, true], ['conta3', true, false], ['conta4', false, true]]);
    expect(o[1].note).toBe('Pausada · iniciar abandona esta missão');
    expect(o[2].note).toBe('Em execução');
    expect(replacedNames(o, ['conta1', 'conta2', 'conta4'])).toEqual(['conta2', 'conta4']);
  });
  it('identidade sob controle ou pausada segue bloqueada mesmo com missão parada', () => {
    const o = missionOptions(snap([idn('conta2', { controlled: true })], [mis('conta2', 'paused')]), PT);
    expect(o[0]).toMatchObject({ disabled: true, replaces: false });
  });
});
