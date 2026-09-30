import type { MessageKey } from '../i18n/messages';
import type { Locale } from '../i18n/locales';
import type { FleetSnapshot, GoalPlan, LiveIdentity, TapflockBridge } from '../live/types';
import { parseGoalPlan } from '../state/goalActions';
import { bridgeMessage } from '../state/providerActions';
import type { GuideActionId, GuideForm, GuideUi } from './script';

/** Fatia da bridge que o Guia usa; tudo opcional (navegador, preload antigo). */
export type GuideBridge = Partial<Pick<TapflockBridge, 'api' | 'base' | 'credentials' | 'login'>>;

/** Linha do registro do painel (spec guia §1.4): nunca carrega segredo. */
export interface GuideLogEntry { readonly ok: boolean; readonly key: MessageKey; readonly params?: Readonly<Record<string, string>> }

export interface GuideContext {
  readonly snap: FleetSnapshot | null;
  readonly account: LiveIdentity | null;
}

export interface GuideDeps {
  readonly getBridge: () => GuideBridge | undefined;
  readonly getLocale: () => Locale;
  /** Texto do objetivo de teste no idioma atual (somente leitura, spec guia §4). */
  readonly testGoalText: () => string;
  readonly setUi: (patch: Partial<GuideUi>) => void;
  readonly log: (entry: GuideLogEntry) => void;
  readonly go: (target: 'new' | 'setup') => void;
  readonly openAccount: (identityId: string) => void;
}

/** Resultado de uma ação: erro legível (texto do daemon ou chave de mensagem) para o cartão atual. */
export type GuideOutcome = { readonly ok: true } | { readonly ok: false; readonly error: string; readonly detail?: string };
export type FormValues = Readonly<Record<string, string>>;

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const HANDLE = /^[A-Za-z0-9._]{1,30}$/;
const OK: GuideOutcome = { ok: true };
const fail = (error: string, detail?: string): GuideOutcome => (detail ? { ok: false, error, detail } : { ok: false, error });
/** Erro com detalhe do daemon: a mensagem do Guia explica o que fazer, o detalhe diz o que aconteceu. */
class GuideError extends Error { constructor(key: string, readonly detail: string) { super(key); } }
const errText = (e: unknown) => (e instanceof Error ? bridgeMessage(e) : String(e));

/** O que o Guia sabe fazer (spec guia §4): só rotas que o main já permite, e nenhuma irreversível. */
export function createGuideActions(deps: GuideDeps) {
  let plan: GoalPlan | null = null;

  const api = async (method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<unknown> => {
    const b = deps.getBridge()?.api;
    if (!b) throw new Error('guide.err.noDaemon');
    return b(method, path, body);
  };
  const attempt = async (fn: () => Promise<void>): Promise<GuideOutcome> => {
    try { await fn(); return OK; } catch (e) { return e instanceof GuideError ? fail(e.message, e.detail) : fail(errText(e)); }
  };
  const idOf = (ctx: GuideContext): string | null => {
    const id = ctx.account?.id ?? null;
    return id && SAFE_ID.test(id) ? id : null;
  };
  const boot = (id: string) => api('POST', `/identities/${id}/boot`, { window: true });

  const planTest = async (ctx: GuideContext): Promise<GuideOutcome> => {
    const id = idOf(ctx);
    if (!id) return fail('guide.err.noAccount');
    deps.setUi({ test: 'planning' });
    try {
      const lang = deps.getLocale();
      const p = parseGoalPlan(await api('POST', '/goals/plan', { text: deps.testGoalText(), lang }));
      // Só a conta do Guia: a confirmação fala dela, e o teste não pode sair em todas as contas prontas.
      const mine = p.tasks.find((t) => t.identityId === id);
      if (!mine?.ready) {
        deps.setUi({ test: 'idle' });
        return fail('guide.err.notReady', mine?.readyLabel || undefined);
      }
      plan = { ...p, tasks: [mine] };
      deps.setUi({ test: 'planned' });
      return OK;
    } catch (e) {
      deps.setUi({ test: 'idle' });
      return fail(errText(e));
    }
  };

  /** Quem precisa da pessoa: a missão parada esperando (e o celular dela) vem antes da conta do Guia. */
  const waiting = (ctx: GuideContext) => ctx.snap?.missions?.find((m) => m.state === 'awaiting-human' && SAFE_ID.test(m.id)) ?? null;
  const humanTarget = (ctx: GuideContext): string | null => {
    const id = waiting(ctx)?.identityId ?? idOf(ctx);
    return id && SAFE_ID.test(id) ? id : null;
  };
  const resolveHuman = (ctx: GuideContext) => attempt(async () => {
    const mission = waiting(ctx);
    if (mission) { await api('POST', `/missions/${mission.id}/continue`); return; }
    const id = idOf(ctx);
    if (!id) throw new Error('guide.err.noAccount');
    await api('POST', `/identities/${id}/resolve`);
  });
  const onAccount = (ctx: GuideContext, path: string, body: unknown) => {
    const id = idOf(ctx);
    return id ? attempt(async () => { await api('POST', `/identities/${id}/${path}`, body); }) : Promise.resolve(fail('guide.err.noAccount'));
  };

  const run = async (action: GuideActionId, ctx: GuideContext): Promise<GuideOutcome> => {
    switch (action) {
      case 'base.prepare':
        return attempt(async () => { await api('POST', '/base/prepare', { lang: deps.getLocale() }); deps.log({ ok: true, key: 'guide.log.basePrep' }); });
      case 'base.continue':
        return attempt(async () => { await api('POST', '/base/continue'); });
      case 'base.recheck':
        return OK;
      case 'phone.create':
        return attempt(async () => {
          const r = await api('POST', '/identities', {});
          const id = typeof r === 'object' && r !== null && typeof (r as { id?: unknown }).id === 'string' ? (r as { id: string }).id : null;
          if (!id || !SAFE_ID.test(id)) throw new Error('guide.err.badReply');
          deps.log({ ok: true, key: 'guide.log.phoneCreated', params: { name: id } });
          await boot(id);
        });
      case 'phone.boot': return onAccount(ctx, 'boot', { window: true });
      case 'phone.unpause': return onAccount(ctx, 'pause', { paused: false });
      case 'phone.release': return onAccount(ctx, 'control', { on: false });
      case 'login.self': deps.setUi({ login: 'handle' }); return OK;
      case 'login.typeForMe': deps.setUi({ login: 'credentials' }); return OK;
      case 'login.back': deps.setUi({ login: 'ask' }); return OK;
      case 'login.recheck': {
        // Conta que já tinha @: o daemon confere a tela antes de aceitar (login-done), então "Entrei" cedo demais falha com o motivo.
        const handle = ctx.account?.handle ?? '';
        if (!HANDLE.test(handle.replace(/^@+/, ''))) { deps.setUi({ login: 'handle' }); return OK; }
        return onAccount(ctx, 'login-done', { handle });
      }
      case 'test.plan': return planTest(ctx);
      case 'test.start':
        if (!plan) return fail('guide.err.noPlan');
        return attempt(async () => {
          await api('POST', '/goals', { text: plan!.text, plan });
          deps.log({ ok: true, key: 'guide.log.testStarted' });
          plan = null;
          deps.setUi({ test: 'idle' });
        });
      case 'test.decline': plan = null; deps.setUi({ test: 'declined' }); return OK;
      case 'test.again': deps.setUi({ test: 'idle' }); return OK;
      case 'human.open': {
        const id = humanTarget(ctx);
        if (!id) return fail('guide.err.noAccount');
        deps.openAccount(id);
        return OK;
      }
      case 'human.resolve': return resolveHuman(ctx);
      case 'go.newMission': deps.go('new'); return OK;
      case 'go.setup': deps.go('setup'); return OK;
    }
  };

  /** Formulários: a senha vai direto para a ponte do cofre e nunca entra no registro nem numa mensagem de erro. */
  const submit = async (form: GuideForm, values: FormValues, ctx: GuideContext): Promise<GuideOutcome> => {
    const bridge = deps.getBridge();
    if (form === 'google') {
      const email = (values.email ?? '').trim();
      if (!email || !values.password) return fail('guide.err.required');
      if (!bridge?.base) return fail('guide.err.noVault');
      return attempt(async () => { await bridge.base!.google(email, values.password!); deps.log({ ok: true, key: 'guide.log.googleSaved' }); });
    }
    const id = idOf(ctx);
    if (!id) return fail('guide.err.noAccount');
    if (form === 'handle') {
      const h = (values.handle ?? '').trim().replace(/^@+/, '');
      if (!HANDLE.test(h)) return fail('guide.err.handle');
      return attempt(async () => {
        await api('POST', `/identities/${id}/login-done`, { handle: `@${h}` });
        deps.setUi({ login: 'ask' });
      });
    }
    const username = (values.username ?? '').trim().replace(/^@+/, '');
    if (!username || !values.password) return fail('guide.err.required');
    if (!bridge?.credentials || !bridge.login) return fail('guide.err.noVault');
    return attempt(async () => {
      await bridge.credentials!.set(id, username, values.password!);
      deps.log({ ok: true, key: 'guide.log.credentialsSaved' });
      const r = await bridge.login!(id);
      if (r.outcome === 'needs-human') {
        // A verificação se faz na janela do celular; o cartão com "Entrei" é o de login.
        deps.setUi({ login: 'ask' });
        throw new GuideError('guide.err.loginHuman', r.detail);
      }
      deps.setUi({ login: 'ask' });
    });
  };

  return { run, submit };
}

export type GuideActions = ReturnType<typeof createGuideActions>;
