import { getIdentity, setIdentityState } from '../db/identities.js';
import { addNote } from '../db/mission-notes.js';
import { randomUUID } from 'node:crypto';
import { createMission, getMission, listMissions, openMissionFor, OPEN_MISSION_STATES, setMissionState, type MissionState } from '../db/missions.js';
import { ABANDONED_BEFORE, cancelWaiting, deliverNote, handOff, handoffLabel } from './chain.js';
import { PAUSE_REASON, runMission, type MissionDeps } from './loop.js';

export interface ChainStep { readonly identityId: string; readonly text: string }

/** Erro de transição com o status HTTP que a rota devolve. */
export class MissionError extends Error {
  constructor(message: string, readonly status: 404 | 409) { super(message); }
}

export interface MissionRunner {
  /** `seed` roda entre criar e lançar: memória inicial (ex.: referência a um segredo do cofre) antes do primeiro passo. */
  /** `replace`: missão aberta que não está rodando (pausada, esperando humano ou esperando a etapa anterior) é abandonada antes. */
  start(identityId: string, text: string, lang: string, seed?: (missionId: string) => void, opts?: { readonly replace?: boolean }): string;
  /**
   * Sequência (spec arquivos): uma missão por etapa, cada uma numa identidade; a primeira roda já, as outras esperam a
   * anterior terminar e recebem o arquivo que ela baixou. Valida todas antes de criar qualquer uma. Devolve os ids na ordem.
   */
  startChain(steps: readonly ChainStep[], lang: string, opts?: { readonly replace?: boolean }): readonly string[];
  pause(id: string): MissionState; resume(id: string): MissionState; continue(id: string): MissionState; abandon(id: string): MissionState;
  resumeAllOnStart(): number;
  settle(): Promise<void>;
}

/** Nota do "Continuar": o que foi pedido já foi feito por uma pessoa; confira a tela e siga. */
export function humanResolvedNote(lang: string, reason: string | null): string {
  const what = (reason ?? '').slice(0, 300);
  return lang.startsWith('pt')
    ? `Um humano já resolveu o que foi pedido${what ? ` ("${what}")` : ''}. Leia a tela atual e siga a missão a partir dela; não peça humano de novo por esse motivo se a tela não mostra mais o bloqueio.`
    : `A human already handled what was asked${what ? ` ("${what}")` : ''}. Read the current screen and continue the mission from it; do not ask for a human again for that reason if the screen no longer shows the blocker.`;
}

/** Transições da missão (spec missões §Ciclo de vida) e no máximo um loop por missão. */
export function createMissionRunner(d: MissionDeps & { readonly run?: typeof runMission }): MissionRunner {
  const loops = new Map<string, Promise<unknown>>();
  const handoffs = new Set<Promise<unknown>>();
  const run = d.run ?? runMission;
  /** Etapa terminou: entrega o arquivo às que a esperam (acompanhado por `settle`). */
  const afterLoop = (id: string) => {
    const m = getMission(d.db, id);
    if (m?.state !== 'done') return;
    const p = handOff(m, { db: d.db, files: d.files, block: (identityId) => (d.isKilled() ? PAUSE_REASON.kill : identityBlock(identityId)), launch, onChange: d.onChange })
      .catch((e: unknown) => console.error(`[missão ${id}] entrega falhou:`, e))
      .finally(() => { handoffs.delete(p); });
    handoffs.add(p);
  };
  const launch = (id: string) => {
    if (loops.has(id)) return;
    const p = run(id, d).catch((e: unknown) => console.error(`[missão ${id}] loop falhou:`, e))
      .finally(() => { loops.delete(id); afterLoop(id); d.onChange?.(); });
    loops.set(id, p);
  };
  const mission = (id: string) => {
    const m = getMission(d.db, id);
    if (!m) throw new MissionError('missão desconhecida', 404);
    return m;
  };
  function identityBlock(identityId: string): string | null {
    const i = getIdentity(d.db, identityId);
    if (!i) return 'identidade desconhecida';
    if (i.discardedAt || i.state === 'banned') return 'identidade banida ou descartada';
    if (i.controlled) return 'identidade sob controle humano; devolva ao agente antes';
    if (i.paused) return 'identidade pausada';
    return null;
  }
  /** Mesmas recusas do `start`, por identidade (sem criar nada). */
  const assertCanStart = (identityId: string, replace = false) => {
    const i = getIdentity(d.db, identityId);
    if (!i) throw new MissionError(`identidade desconhecida: ${identityId}`, 404);
    const block = identityBlock(identityId);
    if (block) throw new MissionError(`${identityId}: ${block}`, 409);
    if (i.state === 'running') throw new MissionError(`${identityId}: identidade rodando um objetivo`, 409);
    const open = openMissionFor(d.db, identityId);
    if (open && (!replace || open.state === 'running' || loops.has(open.id))) throw new MissionError(`${identityId}: identidade já tem uma missão aberta`, 409);
    return i;
  };
  /** Guarda comum de retomar/continuar: loop antigo ainda parando, kill switch ou identidade bloqueada → 409. */
  const assertCanRelaunch = (id: string, identityId: string) => {
    if (loops.has(id)) throw new MissionError('a missão ainda está parando; tente em instantes', 409);
    if (d.isKilled()) throw new MissionError('kill switch acionado: retome a frota antes', 409);
    const block = identityBlock(identityId);
    if (block) throw new MissionError(block, 409);
  };
  const done = (_id: string, s: MissionState) => { d.onChange?.(); return s; };
  /** Abandona uma missão aberta: pausa quem a esperava e tira a identidade de needs-human que a missão pôs. */
  function abandonOpen(id: string): void {
    const m = mission(id);
    setMissionState(d.db, id, 'abandoned');
    cancelWaiting(d.db, id);
    const i = getIdentity(d.db, m.identityId);
    // Loop ativo desfaz o próprio 'running'; aqui só o needs-human que a missão pôs.
    if (i && i.state === 'needs-human' && m.state === 'awaiting-human') setIdentityState(d.db, m.identityId, 'idle', { lastError: null });
  }

  return {
    start: (identityId, text, lang, seed, opts) => {
      const i = getIdentity(d.db, identityId);
      if (!i) throw new MissionError('identidade desconhecida', 404);
      if (d.isKilled()) throw new MissionError('kill switch acionado: retome antes de iniciar uma missão', 409);
      const block = identityBlock(identityId);
      if (block) throw new MissionError(block, 409);
      if (i.state === 'running') throw new MissionError('identidade rodando um objetivo', 409);
      const open = openMissionFor(d.db, identityId);
      if (open) {
        // Só a parada é substituída: com loop vivo (rodando) a identidade está de fato ocupada.
        if (!opts?.replace || open.state === 'running' || loops.has(open.id)) throw new MissionError('identidade já tem uma missão aberta', 409);
        abandonOpen(open.id);
      }
      const id = createMission(d.db, identityId, text, lang);
      // Semente que falhou não pode deixar missão aberta órfã (prenderia a identidade: "já tem uma missão aberta").
      try { seed?.(id); } catch (e) { setMissionState(d.db, id, 'abandoned'); throw e; }
      launch(id); d.onChange?.();
      return id;
    },
    startChain: (steps, lang, opts) => {
      if (d.isKilled()) throw new MissionError('kill switch acionado: retome antes de iniciar uma missão', 409);
      if (new Set(steps.map((s) => s.identityId)).size !== steps.length) throw new MissionError('cada etapa precisa de uma identidade diferente', 409);
      const identities = steps.map((s) => assertCanStart(s.identityId, opts?.replace === true));
      // Validou todas: só agora abandona as missões paradas que a sequência substitui.
      for (const s of steps) { const open = openMissionFor(d.db, s.identityId); if (open) abandonOpen(open.id); }
      const chainId = randomUUID().replace(/-/g, '').slice(0, 8);
      const ids: string[] = [];
      steps.forEach((s, k) => {
        const last = k === steps.length - 1;
        const label = last ? undefined : handoffLabel(chainId, k);
        const id = createMission(d.db, s.identityId, s.text, lang, { waitFor: ids[k - 1], handoffLabel: label });
        if (label) addNote(d.db, id, deliverNote(lang, identities[k + 1].name, label));
        ids.push(id);
      });
      launch(ids[0]); d.onChange?.();
      return ids;
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
      // O planejador só vê o histórico (subtarefa em needs-human com o bloqueio) e a regra "não repita o que falhou";
      // sem saber que alguém resolveu, ele pede humano de novo sem tentar nada. A nota entra como instrução do operador.
      addNote(d.db, id, humanResolvedNote(m.lang, m.humanReason));
      setIdentityState(d.db, m.identityId, 'idle', { lastError: null });
      setMissionState(d.db, id, 'running');
      launch(id);
      return done(id, 'running');
    },
    abandon: (id) => {
      const m = mission(id);
      if (!OPEN_MISSION_STATES.includes(m.state)) throw new MissionError('missão já encerrada', 409);
      abandonOpen(id);
      return done(id, 'abandoned');
    },
    resumeAllOnStart: () => {
      const all = listMissions(d.db, 200);
      const running = all.filter((m) => m.state === 'running');
      running.forEach((m) => launch(m.id));
      // Etapa esperando uma anterior que já terminou (o daemon caiu antes da entrega) ou foi abandonada.
      for (const w of all.filter((m) => m.state === 'waiting' && m.waitFor)) {
        const prev = getMission(d.db, w.waitFor as string);
        if (prev?.state === 'done') afterLoop(prev.id);
        else if (!prev || prev.state === 'abandoned') setMissionState(d.db, w.id, 'paused', ABANDONED_BEFORE);
      }
      return running.length;
    },
    settle: async () => { while (loops.size || handoffs.size) await Promise.all([...loops.values(), ...handoffs]); },
  };
}
