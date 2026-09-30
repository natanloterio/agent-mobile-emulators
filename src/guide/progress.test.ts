import { describe, expect, it } from 'vitest';
import type { BasePrep, FleetSnapshot, LiveIdentity, MissionView } from '../live/types';
import { guideProgress, shouldMarkCompleted } from './progress';

const prep = (state: BasePrep['state']): BasePrep => ({ state, phase: null, error: null, missionId: null, humanReason: null, progress: null });
const baseReady = { name: 'tapflock_golden', found: true, running: false, prep: prep('done') };

function ident(p: Partial<LiveIdentity> = {}): LiveIdentity {
  return {
    id: 'conta1', name: 'conta1', handle: 'sem conta', state: 'provisioned', lifecycle: 'provisioned', task: '', steps: 0, budget: null,
    costUsd: 0, error: '', lastTools: [], online: false, booting: false, bannedReason: null, discardedAt: null, ...p,
  };
}
const mission = (state: MissionView['state']): MissionView => ({
  id: 'm1', identityId: 'conta1', text: 'x', state, humanReason: null, stalled: false, costUsd: 0, startedAt: '', finishedAt: null,
  current: null, subtasks: [], memory: [], notes: [],
});
function snap(p: Partial<FleetSnapshot> = {}): FleetSnapshot {
  return { identities: [], killed: false, updatedAt: '', baseAvd: baseReady, goal: null, missions: [], ...p };
}
const connected = ident({ handle: '@nuvem.cafe', state: 'logged-in', lifecycle: 'logged-in', online: true });
const goal = (state: string) => ({
  id: 'g1', text: 't', pattern: 'fan-out', state, costUsd: 0, createdAt: '', finishedAt: null,
  tasksTotal: 1, tasksDone: state === 'done' ? 1 : 0, tasksFailed: 0, tasksNeeds: 0, tasksRunning: 0, itemsHandled: 0,
});

describe('guideProgress', () => {
  it('sem daemon: só o computador conta, e nada adiante anda', () => {
    const p = guideProgress({ setupCompleted: true, snap: null });
    expect(p.milestones).toEqual(['done', 'todo', 'todo', 'todo']);
    expect(p.current).toBe(1);
  });

  it('marco 1 vem do onboarding', () => {
    expect(guideProgress({ setupCompleted: false, snap: snap() }).milestones[0]).toBe('todo');
    expect(guideProgress({ setupCompleted: false, snap: snap() }).current).toBe(0);
  });

  it.each([
    [{ name: 'b', found: false }, 'todo'],
    [{ name: 'b', found: false, prep: prep('idle') }, 'todo'],
    [{ name: 'b', found: false, prep: prep('running') }, 'doing'],
    [{ name: 'b', found: false, prep: prep('needs-google') }, 'needs-you'],
    [{ name: 'b', found: true, prep: prep('needs-human') }, 'needs-you'],
    [{ name: 'b', found: false, prep: prep('failed') }, 'failed'],
    [{ name: 'b', found: true, running: true, prep: prep('done') }, 'needs-you'],
    [baseReady, 'done'],
  ] as const)('celular-base %o → %s', (baseAvd, want) => {
    expect(guideProgress({ setupCompleted: true, snap: snap({ baseAvd }) }).milestones[1]).toBe(want);
  });

  it('daemon antigo sem baseAvd: não trava o checklist no marco 2', () => {
    expect(guideProgress({ setupCompleted: true, snap: snap({ baseAvd: undefined }) }).milestones[1]).toBe('done');
  });

  it('base ligada por fora explica o motivo', () => {
    const p = guideProgress({ setupCompleted: true, snap: snap({ baseAvd: { ...baseReady, running: true } }) });
    expect(p.baseRunning).toBe(true);
  });

  it.each([
    [[], 'todo'],
    [[ident({ booting: true })], 'doing'],
    [[ident({ online: false })], 'doing'],
    [[ident({ online: true })], 'needs-you'],
    [[connected], 'done'],
    [[ident({ handle: '@x', state: 'idle', lifecycle: 'idle' })], 'done'],
    [[ident({ handle: '@x', state: 'banned', lifecycle: 'banned', bannedReason: 'bloqueio' })], 'todo'],
    [[ident({ discardedAt: '2026-09-01' })], 'todo'],
  ] as const)('primeira conta %#', (identities, want) => {
    expect(guideProgress({ setupCompleted: true, snap: snap({ identities }) }).milestones[2]).toBe(want);
  });

  it('a conta do guia é a conectada; sem ela, a que espera login', () => {
    const waiting = ident({ id: 'conta2', name: 'conta2', online: true });
    expect(guideProgress({ setupCompleted: true, snap: snap({ identities: [waiting, connected] }) }).account?.id).toBe('conta1');
    expect(guideProgress({ setupCompleted: true, snap: snap({ identities: [waiting] }) }).account?.id).toBe('conta2');
  });

  it('um marco só anda depois dos anteriores', () => {
    const p = guideProgress({ setupCompleted: true, snap: snap({ baseAvd: { name: 'b', found: false }, identities: [ident({ online: true })] }) });
    expect(p.milestones).toEqual(['done', 'todo', 'todo', 'todo']);
  });

  it.each([
    [{ goal: null, missions: [] }, 'todo'],
    [{ goal: goal('running'), missions: [] }, 'doing'],
    [{ goal: goal('done'), missions: [] }, 'done'],
    [{ goal: goal('partial'), missions: [] }, 'done'],
    [{ goal: goal('failed'), missions: [] }, 'failed'],
    [{ goal: null, missions: [mission('running')] }, 'doing'],
    [{ goal: null, missions: [mission('awaiting-human')] }, 'needs-you'],
    [{ goal: null, missions: [mission('done')] }, 'done'],
  ] as const)('primeira tarefa %#', (p, want) => {
    expect(guideProgress({ setupCompleted: true, snap: snap({ identities: [connected], ...p }) }).milestones[3]).toBe(want);
  });

  it('conta parada em needs-human durante o teste pede a pessoa', () => {
    const stuck = { ...connected, state: 'needs-human', lifecycle: 'needs-human' };
    expect(guideProgress({ setupCompleted: true, snap: snap({ identities: [stuck], goal: goal('running') }) }).milestones[3]).toBe('needs-you');
  });

  it('configuração já concluída antes: fica concluída, mesmo com objetivo novo que falhou ou conta banida', () => {
    const banned = { ...connected, state: 'banned', lifecycle: 'banned', bannedReason: 'bloqueio' };
    const p = guideProgress({ setupCompleted: true, alreadyCompleted: true, snap: snap({ identities: [banned], goal: goal('failed') }) });
    expect(p.current).toBeNull();
    expect(p.milestones).toEqual(['done', 'done', 'done', 'done']);
  });

  it('tudo feito: current nulo', () => {
    expect(guideProgress({ setupCompleted: true, snap: snap({ identities: [connected], goal: goal('done') }) }).current).toBeNull();
  });
});

describe('shouldMarkCompleted', () => {
  const done = { identities: [connected], goal: goal('done') };
  it('checklist completo num daemon que ainda não sabe: marca', () => {
    const s = snap({ ...done, guide: { completed: false } });
    expect(shouldMarkCompleted(s, guideProgress({ setupCompleted: true, snap: s }))).toBe(true);
  });
  it('já marcado, incompleto ou daemon antigo sem o campo: não marca', () => {
    const marked = snap({ ...done, guide: { completed: true } });
    expect(shouldMarkCompleted(marked, guideProgress({ setupCompleted: true, snap: marked }))).toBe(false);
    const open = snap({ guide: { completed: false } });
    expect(shouldMarkCompleted(open, guideProgress({ setupCompleted: true, snap: open }))).toBe(false);
    const old = snap(done);
    expect(shouldMarkCompleted(old, guideProgress({ setupCompleted: true, snap: old }))).toBe(false);
    expect(shouldMarkCompleted(null, guideProgress({ setupCompleted: true, snap: null }))).toBe(false);
  });
});
