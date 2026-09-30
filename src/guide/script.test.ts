import { describe, expect, it } from 'vitest';
import type { BasePrep, FleetSnapshot, LiveIdentity, LiveProvider, MissionView } from '../live/types';
import { guideProgress } from './progress';
import { INITIAL_UI, nextGuideStep, type GuideUi } from './script';

const prep = (state: BasePrep['state'], extra: Partial<BasePrep> = {}): BasePrep => ({ state, phase: null, error: null, missionId: null, humanReason: null, progress: null, ...extra });
const baseReady = { name: 'tapflock_golden', found: true, running: false, prep: prep('done') };
const ident = (p: Partial<LiveIdentity> = {}): LiveIdentity => ({
  id: 'conta1', name: 'conta1', handle: 'sem conta', state: 'provisioned', lifecycle: 'provisioned', task: '', steps: 0, budget: null,
  costUsd: 0, error: '', lastTools: [], online: false, booting: false, bannedReason: null, discardedAt: null, ...p,
});
const connected = ident({ handle: '@nuvem.cafe', state: 'logged-in', lifecycle: 'logged-in', online: true });
const provider = (mode: 'nuvem' | 'local'): LiveProvider => ({ role: 'worker', mode, model: 'm', endpoint: '', lastTest: null });
const providers = (mode: 'nuvem' | 'local') => ({ lider: { ...provider('nuvem'), role: 'lider' as const }, worker: provider(mode), esc: { ...provider('nuvem'), role: 'esc' as const } });
const snap = (p: Partial<FleetSnapshot> = {}): FleetSnapshot => ({ identities: [], killed: false, updatedAt: '', baseAvd: baseReady, goal: null, missions: [], ...p });
const step = (s: FleetSnapshot | null, ui: GuideUi = INITIAL_UI, setupCompleted = true) => nextGuideStep(guideProgress({ setupCompleted, snap: s }), s, ui);
const ids = (s: ReturnType<typeof step>) => s.buttons.map((b) => b.id);

describe('nextGuideStep: celular-base', () => {
  const base = (p: BasePrep, extra = {}) => snap({ baseAvd: { name: 'b', found: false, prep: p, ...extra } });

  it('onboarding pendente manda de volta para ele', () => {
    expect(ids(step(snap(), INITIAL_UI, false))).toEqual(['go.setup']);
  });
  it('sem base: oferece preparar', () => {
    const s = step(base(prep('idle')));
    expect(s.id).toBe('base.start');
    expect(ids(s)).toEqual(['base.prepare']);
  });
  it('preparando: progresso com a fase atual', () => {
    const s = step(base(prep('running', { phase: 'app', progress: null })));
    expect(s.kind).toBe('progress');
    expect(s.phases?.current).toBe('app');
  });
  it('sem conta Google: formulário, nunca texto livre', () => {
    const s = step(base(prep('needs-google')));
    expect(s.kind).toBe('form');
    expect(s.form).toBe('google');
  });
  it('verificação do Google: pede a pessoa e mostra o motivo', () => {
    const s = step(base(prep('needs-human', { humanReason: 'código por SMS', phase: 'google' })));
    expect(s.kind).toBe('human');
    expect(s.detail).toBe('código por SMS');
    expect(ids(s)).toEqual(['base.continue']);
  });
  it('falhou: motivo e tentar de novo', () => {
    const s = step(base(prep('failed', { error: 'sem conexão' })));
    expect(s.detail).toBe('sem conexão');
    expect(ids(s)).toEqual(['base.prepare']);
  });
  it('base ligada por fora: pede para fechar', () => {
    const s = step(snap({ baseAvd: { ...baseReady, running: true } }));
    expect(s.id).toBe('base.close');
    expect(s.kind).toBe('human');
  });
});

describe('nextGuideStep: primeira conta', () => {
  it('sem celular: criar', () => {
    expect(ids(step(snap()))).toEqual(['phone.create']);
  });
  it('ligando: progresso e destaque no tile', () => {
    const s = step(snap({ identities: [ident({ booting: true })] }));
    expect(s.kind).toBe('progress');
    expect(s.point).toBe('tile');
  });
  it('desligado: ligar, com o erro do daemon se houver', () => {
    const s = step(snap({ identities: [ident({ online: false, error: 'boot falhou' })] }));
    expect(ids(s)).toEqual(['phone.boot']);
    expect(s.detail).toBe('boot falhou');
  });
  it('online sem login: a pessoa entra, ou pede para o Tapflock digitar', () => {
    const s = step(snap({ identities: [ident({ online: true })] }));
    expect(s.kind).toBe('human');
    expect(ids(s)).toEqual(['login.self', 'login.typeForMe']);
    expect(s.params).toEqual({ name: 'conta1' });
  });
  it('depois de "Entrei": pede o @', () => {
    const s = step(snap({ identities: [ident({ online: true })] }), { ...INITIAL_UI, login: 'handle' });
    expect(s.form).toBe('handle');
    expect(ids(s)).toEqual(['login.back']);
  });
  it('"Tapflock digita": formulário de credenciais', () => {
    expect(step(snap({ identities: [ident({ online: true })] }), { ...INITIAL_UI, login: 'credentials' }).form).toBe('credentials');
  });
  it('o id da situação muda com a conta: cartão novo para outra identidade', () => {
    const a = step(snap({ identities: [ident({ online: true })] }));
    const b = step(snap({ identities: [ident({ id: 'conta2', name: 'conta2', online: true })] }));
    expect(a.id).not.toBe(b.id);
  });
});

describe('nextGuideStep: primeira tarefa', () => {
  const ready = (p: Partial<FleetSnapshot> = {}) => snap({ identities: [connected], providers: providers('local'), ...p });
  const mission = (state: MissionView['state'], humanReason: string | null = null): MissionView => ({
    id: 'm1', identityId: 'conta1', text: 'x', state, humanReason, stalled: false, costUsd: 0, startedAt: '', finishedAt: null, current: null, subtasks: [], memory: [], notes: [],
  });
  const goal = (state: string) => ({ id: 'g', text: 't', pattern: 'fan-out', state, costUsd: 0, createdAt: '', finishedAt: null, tasksTotal: 1, tasksDone: 0, tasksFailed: 0, tasksNeeds: 0, tasksRunning: 1, itemsHandled: 0 });

  it('oferece o teste; recusar é sempre possível', () => {
    expect(ids(step(ready()))).toEqual(['test.plan', 'test.decline']);
  });
  it('planejando: progresso', () => {
    expect(step(ready(), { ...INITIAL_UI, test: 'planning' }).kind).toBe('progress');
  });
  it('planejado: confirmação, grátis com worker local', () => {
    const s = step(ready(), { ...INITIAL_UI, test: 'planned' });
    expect(s.kind).toBe('confirm');
    expect(s.body).toBe('guide.test.confirm.free');
    expect(ids(s)).toEqual(['test.start', 'test.decline']);
  });
  it('planejado com worker na nuvem: avisa que custa', () => {
    expect(step(ready({ providers: providers('nuvem') }), { ...INITIAL_UI, test: 'planned' }).body).toBe('guide.test.confirm.paid');
  });
  it('recusado: dá para voltar', () => {
    expect(ids(step(ready(), { ...INITIAL_UI, test: 'declined' }))).toEqual(['test.again']);
  });
  it('rodando: progresso com destaque', () => {
    expect(step(ready({ goal: goal('running') })).point).toBe('tile');
  });
  it('missão esperando a pessoa: motivo, abrir e resolvido', () => {
    const s = step(ready({ missions: [mission('awaiting-human', 'captcha')] }));
    expect(s.detail).toBe('captcha');
    expect(ids(s)).toEqual(['human.open', 'human.resolve']);
  });
  it('falhou: tentar de novo', () => {
    expect(ids(step(ready({ goal: goal('failed') })))).toEqual(['test.plan']);
  });
  it('falhou e a pessoa tentou de novo: segue para planejar e confirmar', () => {
    expect(step(ready({ goal: goal('failed') }), { ...INITIAL_UI, test: 'planning' }).id).toBe('test.planning');
    expect(step(ready({ goal: goal('failed') }), { ...INITIAL_UI, test: 'planned' }).kind).toBe('confirm');
  });
  it('conta conectada mas desligada: liga antes de oferecer o teste', () => {
    const off = snap({ identities: [{ ...connected, online: false }], providers: providers('local') });
    expect(ids(step(off))).toEqual(['phone.boot']);
    expect(step(off).milestone).toBe(3);
    expect(step(snap({ identities: [{ ...connected, online: false, booting: true }] })).kind).toBe('progress');
  });
  it('conta conectada em needs-human: pede a pessoa, com o motivo', () => {
    const s = step(ready({ identities: [{ ...connected, state: 'needs-human', lifecycle: 'needs-human', error: 'checkpoint' }] }));
    expect(s.kind).toBe('human');
    expect(s.detail).toBe('checkpoint');
    expect(ids(s)).toEqual(['human.open', 'human.resolve']);
  });
  describe('Instagram deslogado (o teste parou na tela de login)', () => {
    const LOGGED_OUT = 'Instagram deslogado (tela de login): faça login à mão no device e depois marque como resolvido';
    const out = { ...connected, state: 'needs-human', lifecycle: 'needs-human', error: LOGGED_OUT };
    it('teste que falhou por isso: cartão de entrar de novo, não o "não deu certo" genérico', () => {
      const s = step(ready({ identities: [out], goal: goal('failed') }));
      expect(s.id).toBe('account.loggedOut:conta1');
      expect(s.kind).toBe('human');
      expect(s.title).toBe('guide.account.loggedOut.title');
      expect(ids(s)).toEqual(['login.recheck', 'login.typeForMe']);
      expect(s.point).toBe('tile');
    });
    it('também com o objetivo ainda aberto e sem objetivo nenhum', () => {
      expect(step(ready({ identities: [out], goal: goal('running') })).id).toBe('account.loggedOut:conta1');
      expect(step(ready({ identities: [out] })).id).toBe('account.loggedOut:conta1');
    });
    it('deslogado e desligado: liga o celular primeiro (não há janela onde entrar)', () => {
      const s = step(ready({ identities: [{ ...out, online: false }], goal: goal('failed') }));
      expect(ids(s)).toEqual(['phone.boot']);
      expect(step(ready({ identities: [{ ...out, online: false, booting: true }] })).kind).toBe('progress');
    });
    it('"Tapflock digita" aqui abre o formulário de login', () => {
      const s = step(ready({ identities: [out], goal: goal('failed') }), { ...INITIAL_UI, login: 'credentials' });
      expect(s.form).toBe('credentials');
      expect(s.milestone).toBe(3);
    });
    it('depois de entrar de novo, o teste que falhou pode ser refeito', () => {
      expect(ids(step(ready({ goal: goal('failed') })))).toEqual(['test.plan']);
    });
  });
  it('conta pausada ou sob controle da pessoa: devolve ao agente antes do teste', () => {
    expect(ids(step(ready({ identities: [{ ...connected, paused: true }] })))).toEqual(['phone.unpause']);
    expect(ids(step(ready({ identities: [{ ...connected, controlled: true }] })))).toEqual(['phone.release']);
  });
  it('tudo feito: leva para a primeira missão', () => {
    const s = step(ready({ goal: goal('done') }));
    expect(s.kind).toBe('done');
    expect(s.point).toBe('new-mission');
    expect(ids(s)).toEqual(['go.newMission']);
  });
});
