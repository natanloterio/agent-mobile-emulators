import { getIdentity, setIdentityState } from '../db/identities.js';
import { createMission, getMission, listMissions, openMissionFor, OPEN_MISSION_STATES, setMissionState, type MissionState } from '../db/missions.js';
import { PAUSE_REASON, runMission, type MissionDeps } from './loop.js';

/** Erro de transição com o status HTTP que a rota devolve. */
export class MissionError extends Error {
  constructor(message: string, readonly status: 404 | 409) { super(message); }
}

export interface MissionRunner {
  start(identityId: string, text: string, lang: string): string;
  pause(id: string): MissionState; resume(id: string): MissionState; continue(id: string): MissionState; abandon(id: string): MissionState;
  resumeAllOnStart(): number;
  settle(): Promise<void>;
}

/** Transições da missão (spec missões §Ciclo de vida) e no máximo um loop por missão. */
export function createMissionRunner(d: MissionDeps & { readonly run?: typeof runMission }): MissionRunner {
  const loops = new Map<string, Promise<unknown>>();
  const run = d.run ?? runMission;
  const launch = (id: string) => {
    if (loops.has(id)) return;
    const p = run(id, d).catch((e: unknown) => console.error(`[missão ${id}] loop falhou:`, e))
      .finally(() => { loops.delete(id); d.onChange?.(); });
    loops.set(id, p);
  };
  const mission = (id: string) => {
    const m = getMission(d.db, id);
    if (!m) throw new MissionError('missão desconhecida', 404);
    return m;
  };
  const identityBlock = (identityId: string): string | null => {
    const i = getIdentity(d.db, identityId);
    if (!i) return 'identidade desconhecida';
    if (i.discardedAt || i.state === 'banned') return 'identidade banida ou descartada';
    if (i.controlled) return 'identidade sob controle humano; devolva ao agente antes';
    if (i.paused) return 'identidade pausada';
    return null;
  };
  /** Guarda comum de retomar/continuar: loop antigo ainda parando, kill switch ou identidade bloqueada → 409. */
  const assertCanRelaunch = (id: string, identityId: string) => {
    if (loops.has(id)) throw new MissionError('a missão ainda está parando; tente em instantes', 409);
    if (d.isKilled()) throw new MissionError('kill switch acionado: retome a frota antes', 409);
    const block = identityBlock(identityId);
    if (block) throw new MissionError(block, 409);
  };
  const done = (_id: string, s: MissionState) => { d.onChange?.(); return s; };

  return {
    start: (identityId, text, lang) => {
      const i = getIdentity(d.db, identityId);
      if (!i) throw new MissionError('identidade desconhecida', 404);
      if (d.isKilled()) throw new MissionError('kill switch acionado: retome antes de iniciar uma missão', 409);
      const block = identityBlock(identityId);
      if (block) throw new MissionError(block, 409);
      if (i.state === 'running') throw new MissionError('identidade rodando um objetivo', 409);
      if (openMissionFor(d.db, identityId)) throw new MissionError('identidade já tem uma missão aberta', 409);
      const id = createMission(d.db, identityId, text, lang);
      launch(id); d.onChange?.();
      return id;
    },
    pause: (id) => {
      if (mission(id).state !== 'running') throw new MissionError('só missão em execução pode ser pausada', 409);
      setMissionState(d.db, id, 'paused', PAUSE_REASON.user);
      return done(id, 'paused');
    },
    resume: (id) => {
      const m = mission(id);
      if (m.state !== 'paused') throw new MissionError('só missão pausada pode ser retomada', 409);
      assertCanRelaunch(id, m.identityId);
      setMissionState(d.db, id, 'running');
      launch(id);
      return done(id, 'running');
    },
    continue: (id) => {
      const m = mission(id);
      if (m.state !== 'awaiting-human') throw new MissionError('a missão não está esperando humano', 409);
      assertCanRelaunch(id, m.identityId);
      setIdentityState(d.db, m.identityId, 'idle', { lastError: null });
      setMissionState(d.db, id, 'running');
      launch(id);
      return done(id, 'running');
    },
    abandon: (id) => {
      const m = mission(id);
      if (!OPEN_MISSION_STATES.includes(m.state)) throw new MissionError('missão já encerrada', 409);
      setMissionState(d.db, id, 'abandoned');
      const i = getIdentity(d.db, m.identityId);
      // Loop ativo desfaz o próprio 'running'; aqui só o needs-human que a missão pôs.
      if (i && i.state === 'needs-human' && m.state === 'awaiting-human') setIdentityState(d.db, m.identityId, 'idle', { lastError: null });
      return done(id, 'abandoned');
    },
    resumeAllOnStart: () => {
      const running = listMissions(d.db, 200).filter((m) => m.state === 'running');
      running.forEach((m) => launch(m.id));
      return running.length;
    },
    settle: async () => { while (loops.size) await Promise.all([...loops.values()]); },
  };
}
