import { listNotes } from '../src/db/mission-notes.js';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { getIdentity, setIdentityFlags, setIdentityState, upsertIdentity } from '../src/db/identities.js';
import { createMission, getMission, setMissionState } from '../src/db/missions.js';
import type { MissionDeps } from '../src/mission/loop.js';
import { createMissionRunner, MissionError } from '../src/mission/runner.js';

const row = { id: 'conta2', name: 'conta2', handle: 'sem conta', avdName: 'x', serial: 's', consolePort: 5556, mcpHostPort: 8081, mcpToken: 't', deviceSlug: 'conta2', appPackage: 'com.instagram.android', appVersionName: '1', state: 'idle' as const };

function mk(o: { killed?: boolean } = {}) {
  const db = openDb(':memory:'); upsertIdentity(db, row);
  const ran: string[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => { release = r; });
  const deps = { db, isKilled: () => !!o.killed } as unknown as MissionDeps;
  const runner = createMissionRunner({ ...deps, run: async (id) => { ran.push(id); await gate; return 'running' as const; } });
  return { db, runner, ran, release };
}
const status = (f: () => unknown) => { try { f(); return 0; } catch (e) { return (e as MissionError).status; } };

describe('runner de missões', () => {
  it('start com replace abandona a missão pausada/esperando humano e começa outra; rodando continua bloqueando', async () => {
    const h = mk();
    const old = createMission(h.db, 'conta2', 'antiga', 'pt');
    setMissionState(h.db, old, 'paused', 'infra: fetch failed');
    expect(status(() => h.runner.start('conta2', 'nova', 'pt'))).toBe(409);
    const id = h.runner.start('conta2', 'nova', 'pt', undefined, { replace: true });
    expect(getMission(h.db, old)?.state).toBe('abandoned');
    expect(getMission(h.db, id)?.state).toBe('running');
    // A nova está rodando (loop ativo): replace não derruba missão em execução.
    expect(status(() => h.runner.start('conta2', 'outra', 'pt', undefined, { replace: true }))).toBe(409);
    h.release(); await h.runner.settle();
  });
  it('replace de missão esperando humano devolve a identidade de needs-human', () => {
    const h = mk();
    const old = createMission(h.db, 'conta2', 'antiga', 'pt');
    setMissionState(h.db, old, 'awaiting-human', 'captcha'); setIdentityState(h.db, 'conta2', 'needs-human');
    h.runner.start('conta2', 'nova', 'pt', undefined, { replace: true });
    expect(getMission(h.db, old)?.state).toBe('abandoned');
    expect(getIdentity(h.db, 'conta2')?.state).not.toBe('needs-human');
  });
  it('start cria e lança o loop; segunda missão na mesma identidade → 409', async () => {
    const h = mk();
    const id = h.runner.start('conta2', 'crie um e-mail', 'pt');
    expect(h.ran).toEqual([id]);
    expect(status(() => h.runner.start('conta2', 'outra', 'pt'))).toBe(409);
    expect(status(() => h.runner.start('nada', 'x', 'pt'))).toBe(404);
    h.release(); await h.runner.settle();
  });
  it('start recusa identidade banida, sob controle, pausada, rodando objetivo, ou com kill switch', () => {
    const h = mk();
    setIdentityFlags(h.db, 'conta2', { controlled: true }); expect(status(() => h.runner.start('conta2', 'x', 'pt'))).toBe(409);
    setIdentityFlags(h.db, 'conta2', { controlled: false, paused: true }); expect(status(() => h.runner.start('conta2', 'x', 'pt'))).toBe(409);
    setIdentityFlags(h.db, 'conta2', { paused: false }); setIdentityState(h.db, 'conta2', 'running'); expect(status(() => h.runner.start('conta2', 'x', 'pt'))).toBe(409);
    setIdentityState(h.db, 'conta2', 'banned'); expect(status(() => h.runner.start('conta2', 'x', 'pt'))).toBe(409);
    expect(status(() => mk({ killed: true }).runner.start('conta2', 'x', 'pt'))).toBe(409);
  });
  it('pause só de running; resume só de paused e sem loop ativo; abandon de qualquer aberta', async () => {
    const h = mk();
    const id = h.runner.start('conta2', 'x', 'pt');
    expect(h.runner.pause(id)).toBe('paused');
    expect(getMission(h.db, id)?.humanReason).toBe('pausada pelo usuário');
    expect(status(() => h.runner.pause(id))).toBe(409);
    expect(status(() => h.runner.resume(id))).toBe(409); // loop antigo ainda parando
    h.release(); await h.runner.settle();
    expect(h.runner.resume(id)).toBe('running');
    expect(h.ran).toEqual([id, id]);
    expect(h.runner.abandon(id)).toBe('abandoned');
    expect(status(() => h.runner.abandon(id))).toBe(409);
    await h.runner.settle();
  });
  it('continue: só de awaiting-human, sem controle humano; identidade volta de needs-human', async () => {
    const h = mk();
    const id = createMission(h.db, 'conta2', 'x', 'pt');
    setMissionState(h.db, id, 'awaiting-human', 'captcha'); setIdentityState(h.db, 'conta2', 'needs-human');
    setIdentityFlags(h.db, 'conta2', { controlled: true });
    expect(status(() => h.runner.continue(id))).toBe(409);
    setIdentityFlags(h.db, 'conta2', { controlled: false });
    expect(h.runner.continue(id)).toBe('running');
    expect(getIdentity(h.db, 'conta2')?.state).toBe('idle');
    expect(getMission(h.db, id)?.humanReason).toBeNull();
    h.release(); await h.runner.settle();
  });
  it('continue deixa uma nota para o planejador: o humano resolveu o motivo (senão ele pede humano de novo pelo histórico)', async () => {
    const h = mk();
    const id = createMission(h.db, 'conta2', 'x', 'pt');
    setMissionState(h.db, id, 'awaiting-human', 'Google pediu passkey'); setIdentityState(h.db, 'conta2', 'needs-human');
    h.runner.continue(id);
    const notes = listNotes(h.db, id).map((n) => n.text);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/Google pediu passkey/);
    expect(notes[0]).toMatch(/humano/i);
    h.release(); await h.runner.settle();
  });
  it('abandon de awaiting-human devolve a identidade a idle', () => {
    const h = mk();
    const id = createMission(h.db, 'conta2', 'x', 'pt');
    setMissionState(h.db, id, 'awaiting-human', 'captcha'); setIdentityState(h.db, 'conta2', 'needs-human');
    h.runner.abandon(id);
    expect(getIdentity(h.db, 'conta2')?.state).toBe('idle');
  });
  it('resumeAllOnStart relança só as running', async () => {
    const h = mk();
    const a = createMission(h.db, 'conta2', 'a', 'pt');
    upsertIdentity(h.db, { ...row, id: 'conta3', name: 'conta3', deviceSlug: 'conta3' });
    const b = createMission(h.db, 'conta3', 'b', 'pt'); setMissionState(h.db, b, 'paused', 'kill switch');
    expect(h.runner.resumeAllOnStart()).toBe(1);
    expect(h.ran).toEqual([a]);
    h.release(); await h.runner.settle();
  });
});
