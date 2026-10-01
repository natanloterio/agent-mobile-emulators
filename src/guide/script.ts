import type { MessageKey } from '../i18n/messages';
import type { BasePhase, FleetSnapshot, LiveIdentity } from '../live/types';
import { lifecycleOf, type GuideProgress, type MilestoneIndex } from './progress';

/** Estado local do painel que o snapshot não carrega (spec guia §4): o que a pessoa escolheu nesta sessão. */
export interface GuideUi {
  /** Depois de "Entrei" pede o @; depois de "Prefiro que o Tapflock digite" pede usuário e senha. */
  readonly login: 'ask' | 'handle' | 'credentials';
  /** Plano do teste do marco 4, pedido ao líder e esperando a confirmação da pessoa. */
  readonly test: 'idle' | 'planning' | 'planned' | 'declined';
}
export const INITIAL_UI: GuideUi = { login: 'ask', test: 'idle' };

/** Ações que um botão do Guia dispara; `useGuide` as liga às rotas do daemon. */
export type GuideActionId =
  | 'base.prepare' | 'base.continue' | 'base.recheck'
  | 'phone.create' | 'phone.boot' | 'phone.unpause' | 'phone.release'
  | 'login.self' | 'login.typeForMe' | 'login.back' | 'login.recheck'
  | 'test.plan' | 'test.start' | 'test.decline' | 'test.again'
  | 'human.open' | 'human.resolve'
  | 'go.newMission' | 'go.setup';
export type GuideForm = 'google' | 'handle' | 'credentials' | 'pin';
/** Alvos de destaque (spec guia §3.4): `data-guide` nas telas. */
export type GuideTarget = 'tile' | 'new-mission';

export interface GuideButton { readonly id: GuideActionId; readonly label: MessageKey; readonly variant: 'primary' | 'secondary' | 'ghost' }
export interface GuideStep {
  /** Situação estável: o painel só troca o cartão quando ela muda. */
  readonly id: string;
  readonly kind: 'action' | 'progress' | 'human' | 'form' | 'confirm' | 'done' | 'idle';
  readonly milestone: MilestoneIndex | null;
  readonly title: MessageKey;
  readonly body?: MessageKey;
  readonly params?: Readonly<Record<string, string | number>>;
  /** Motivo vindo do daemon (texto livre ou código de erro), mostrado abaixo do corpo. */
  readonly detail?: string | null;
  readonly buttons: readonly GuideButton[];
  readonly form?: GuideForm;
  readonly phases?: { readonly current: BasePhase | null; readonly progress: number | null };
  readonly point?: GuideTarget;
}

const btn = (id: GuideActionId, label: MessageKey, variant: GuideButton['variant'] = 'primary'): GuideButton => ({ id, label, variant });

function baseStep(p: GuideProgress, snap: FleetSnapshot | null): GuideStep {
  const prep = snap?.baseAvd?.prep;
  const m = 1 as const;
  if (p.baseRunning) {
    return { id: 'base.close', kind: 'human', milestone: m, title: 'guide.base.close.title', body: 'guide.base.close.body', buttons: [btn('base.recheck', 'guide.base.close.done')] };
  }
  switch (p.milestones[1]) {
    case 'doing':
      return { id: 'base.running', kind: 'progress', milestone: m, title: 'guide.base.running.title', body: 'guide.base.running.body', buttons: [], phases: { current: prep?.phase ?? null, progress: prep?.progress ?? null } };
    case 'needs-you':
      return prep?.state === 'needs-google'
        ? { id: 'base.google', kind: 'form', milestone: m, title: 'guide.base.google.title', body: 'guide.base.google.body', buttons: [], form: 'google' }
        : { id: 'base.human', kind: 'human', milestone: m, title: 'guide.base.human.title', body: 'guide.base.human.body', detail: prep?.humanReason ?? null, buttons: [btn('base.continue', 'guide.human.did')], phases: { current: prep?.phase ?? null, progress: null } };
    case 'failed':
      return { id: 'base.failed', kind: 'action', milestone: m, title: 'guide.base.failed.title', body: 'guide.base.failed.body', detail: prep?.error ?? null, buttons: [btn('base.prepare', 'guide.retry')] };
    default:
      return { id: 'base.start', kind: 'action', milestone: m, title: 'guide.base.start.title', body: 'guide.base.start.body', buttons: [btn('base.prepare', 'guide.base.start.go')] };
  }
}

function accountStep(p: GuideProgress, ui: GuideUi): GuideStep {
  const a = p.account;
  const m = 2 as const;
  if (!a) {
    return { id: 'phone.create', kind: 'action', milestone: m, title: 'guide.phone.create.title', body: 'guide.phone.create.body', buttons: [btn('phone.create', 'guide.phone.create.go')] };
  }
  const params = { name: a.name };
  if (isLockError(a.error)) return lockedStep(a, m);
  const power = powerStep(a, m);
  if (power) return power;
  if (ui.login === 'handle') {
    return { id: `login.handle:${a.id}`, kind: 'form', milestone: m, title: 'guide.login.handle.title', body: 'guide.login.handle.body', params, buttons: [btn('login.back', 'guide.back', 'ghost')], form: 'handle' };
  }
  if (ui.login === 'credentials') {
    return { id: `login.credentials:${a.id}`, kind: 'form', milestone: m, title: 'guide.login.credentials.title', body: 'guide.login.credentials.body', params, buttons: [btn('login.back', 'guide.back', 'ghost')], form: 'credentials' };
  }
  return {
    id: `login.ask:${a.id}`, kind: 'human', milestone: m, title: 'guide.login.ask.title', body: 'guide.login.ask.body', params, point: 'tile',
    buttons: [btn('login.self', 'guide.login.ask.done'), btn('login.typeForMe', 'guide.login.ask.typeForMe', 'ghost')],
  };
}

/** Celular ligando ou desligado: o mesmo cartão serve aos marcos 3 e 4 (depois de reabrir o app ele volta desligado). */
function powerStep(a: LiveIdentity, m: MilestoneIndex): GuideStep | null {
  const params = { name: a.name };
  if (a.booting) {
    return { id: `phone.booting:${a.id}`, kind: 'progress', milestone: m, title: 'guide.phone.booting.title', body: 'guide.phone.booting.body', params, buttons: [], point: 'tile' };
  }
  if (!a.online) {
    return { id: `phone.off:${a.id}`, kind: 'action', milestone: m, title: 'guide.phone.off.title', body: 'guide.phone.off.body', params, detail: a.error || null, buttons: [btn('phone.boot', 'guide.phone.off.go')] };
  }
  return null;
}

/** Erros do desbloqueio (device/unlock.ts): o celular está na tela de bloqueio e o Tapflock não tem o PIN, ou o PIN falhou. */
export const isLockError = (error: string | undefined) => /^(?:device bloqueado|PIN recusado|PIN inválido)/.test(error ?? '');

/** Celular travado: ligar primeiro (sem janela não há onde digitar), depois pedir o PIN num formulário. */
function lockedStep(a: LiveIdentity, m: MilestoneIndex): GuideStep {
  return powerStep(a, m) ?? {
    id: `phone.locked:${a.id}`, kind: 'form', milestone: m, title: 'guide.phone.locked.title', body: 'guide.phone.locked.body', params: { name: a.name }, buttons: [], form: 'pin', point: 'tile',
  };
}

/** Erro que o daemon grava quando o worker acha o Instagram na tela de login (screen/checks.ts `detectLoggedOut`). */
export const isLoggedOutError = (error: string | undefined) => /^Instagram deslogado/.test(error ?? '');

/**
 * O Instagram da conta deslogou (ou nunca logou: a pessoa clicou "Entrei" antes da hora). Entrar de novo na janela e
 * "Entrei" (que o daemon confere lendo a tela), ou deixar o Tapflock digitar.
 */
function loggedOutStep(a: LiveIdentity, ui: GuideUi): GuideStep {
  const m = 3 as const;
  const params = { name: a.name };
  const power = powerStep(a, m);
  if (power) return power;
  if (ui.login === 'credentials') {
    return { id: `account.credentials:${a.id}`, kind: 'form', milestone: m, title: 'guide.login.credentials.title', body: 'guide.login.credentials.body', params, buttons: [btn('login.back', 'guide.back', 'ghost')], form: 'credentials' };
  }
  return {
    id: `account.loggedOut:${a.id}`, kind: 'human', milestone: m, title: 'guide.account.loggedOut.title', body: 'guide.account.loggedOut.body', params, point: 'tile',
    buttons: [btn('login.recheck', 'guide.login.ask.done'), btn('login.typeForMe', 'guide.login.ask.typeForMe', 'ghost')],
  };
}

/** A conta conectada precisa estar livre para o teste: sem verificação pendente, ligada, sem pausa e sem a pessoa no controle. */
function accountReadyStep(a: LiveIdentity, ui: GuideUi): GuideStep | null {
  const m = 3 as const;
  const params = { name: a.name };
  if (isLockError(a.error)) return lockedStep(a, m);
  if (lifecycleOf(a) === 'needs-human' && isLoggedOutError(a.error)) return loggedOutStep(a, ui);
  if (lifecycleOf(a) === 'needs-human') {
    return {
      id: `account.human:${a.id}`, kind: 'human', milestone: m, title: 'guide.test.human.title', body: 'guide.test.human.body', params, detail: a.error || null,
      buttons: [btn('human.open', 'guide.test.human.open'), btn('human.resolve', 'guide.test.human.resolved', 'secondary')],
    };
  }
  const power = powerStep(a, m);
  if (power) return power;
  if (a.paused) return { id: `account.paused:${a.id}`, kind: 'action', milestone: m, title: 'guide.phone.paused.title', body: 'guide.phone.paused.body', params, buttons: [btn('phone.unpause', 'guide.phone.paused.go')] };
  if (a.controlled) return { id: `account.controlled:${a.id}`, kind: 'action', milestone: m, title: 'guide.phone.controlled.title', body: 'guide.phone.controlled.body', params, buttons: [btn('phone.release', 'guide.phone.controlled.go')] };
  return null;
}

function humanReason(snap: FleetSnapshot | null, a: LiveIdentity | null): string | null {
  const mission = snap?.missions?.find((x) => x.state === 'awaiting-human');
  return mission?.humanReason ?? (a?.error || null);
}

function taskStep(p: GuideProgress, snap: FleetSnapshot | null, ui: GuideUi): GuideStep {
  const m = 3 as const;
  const a = p.account;
  const params = { name: a?.name ?? '' };
  // Deslogado vence qualquer outro cartão do teste: é a causa, e tem saída direta.
  if (a && lifecycleOf(a) === 'needs-human' && isLoggedOutError(a.error)) return loggedOutStep(a, ui);
  switch (p.milestones[3]) {
    case 'doing':
      return { id: 'test.running', kind: 'progress', milestone: m, title: 'guide.test.running.title', body: 'guide.test.running.body', params, buttons: [], point: 'tile' };
    case 'needs-you':
      return {
        id: 'test.human', kind: 'human', milestone: m, title: 'guide.test.human.title', body: 'guide.test.human.body', params, detail: humanReason(snap, p.account),
        buttons: [btn('human.open', 'guide.test.human.open'), btn('human.resolve', 'guide.test.human.resolved', 'secondary')],
      };
    case 'failed': {
      // O que prende a conta vem antes do "falhou"; depois de "Tentar de novo" o cartão segue o plano novo.
      const blocked = a ? accountReadyStep(a, ui) : null;
      if (blocked) return blocked;
      if (ui.test === 'idle') return { id: 'test.failed', kind: 'action', milestone: m, title: 'guide.test.failed.title', body: 'guide.test.failed.body', buttons: [btn('test.plan', 'guide.retry')] };
      break;
    }
    default:
      break;
  }
  if (ui.test === 'declined') {
    return { id: 'test.declined', kind: 'action', milestone: m, title: 'guide.test.declined.title', body: 'guide.test.declined.body', buttons: [btn('test.again', 'guide.test.declined.again', 'secondary')] };
  }
  // Teste adiado não insiste; fora isso, a conta precisa estar livre antes de planejar.
  const blocked = a ? accountReadyStep(a, ui) : null;
  if (blocked) return blocked;
  if (ui.test === 'planning') {
    return { id: 'test.planning', kind: 'progress', milestone: m, title: 'guide.test.planning.title', body: 'guide.test.planning.body', params, buttons: [] };
  }
  const free = snap?.providers?.worker.mode === 'local';
  if (ui.test === 'planned') {
    return {
      id: 'test.confirm', kind: 'confirm', milestone: m, title: 'guide.test.confirm.title', body: free ? 'guide.test.confirm.free' : 'guide.test.confirm.paid', params,
      buttons: [btn('test.start', 'guide.test.confirm.go'), btn('test.decline', 'guide.test.confirm.later', 'ghost')],
    };
  }
  return {
    id: 'test.offer', kind: 'action', milestone: m, title: 'guide.test.offer.title', body: 'guide.test.offer.body', params,
    buttons: [btn('test.plan', 'guide.test.offer.go'), btn('test.decline', 'guide.test.confirm.later', 'ghost')],
  };
}

/**
 * Cartão que o Guia mostra agora (spec guia §4). Puro e idempotente: chamado a cada snapshot, retoma no mesmo ponto
 * depois de um reinício porque tudo vem do snapshot, menos as escolhas desta sessão (`ui`).
 */
export function nextGuideStep(p: GuideProgress, snap: FleetSnapshot | null, ui: GuideUi = INITIAL_UI): GuideStep {
  switch (p.current) {
    case 0:
      return { id: 'setup', kind: 'action', milestone: 0, title: 'guide.setup.title', body: 'guide.setup.body', buttons: [btn('go.setup', 'guide.setup.go')] };
    case 1:
      return baseStep(p, snap);
    case 2:
      return accountStep(p, ui);
    case 3:
      return taskStep(p, snap, ui);
    default:
      // Com a primeira missão criada, o "tudo configurado" cumpriu o papel: fica o estado quieto até algo pedir a pessoa.
      if (snap?.missions?.length) return { id: 'idle', kind: 'idle', milestone: null, title: 'guide.idle.title', body: 'guide.idle.body', buttons: [] };
      return { id: 'done', kind: 'done', milestone: null, title: 'guide.done.title', body: 'guide.done.body', buttons: [btn('go.newMission', 'guide.done.go')], point: 'new-mission' };
  }
}

/** O painel fecha sozinho quando a pessoa cria a primeira missão (o foco passa a ser o Cockpit); só nessa passagem. */
export const closesPanel = (prev: string | null, next: string): boolean => prev === 'done' && next === 'idle';
