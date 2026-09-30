import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import type { MessageKey } from '../i18n/messages';
import type { FleetSnapshot } from '../live/types';
import { createGuideActions, type FormValues, type GuideLogEntry } from './actions';
import { guideProgress, shouldMarkCompleted, type GuideProgress } from './progress';
import { INITIAL_UI, nextGuideStep, type GuideActionId, type GuideForm, type GuideStep, type GuideUi } from './script';

export interface GuideError { readonly message: string; readonly detail: string | null }

export interface UseGuideOptions {
  readonly snap: FleetSnapshot | null;
  readonly setupCompleted: boolean;
  readonly go: (target: 'new' | 'setup') => void;
  readonly openAccount: (identityId: string) => void;
}

export interface UseGuide {
  readonly progress: GuideProgress;
  readonly step: GuideStep;
  readonly log: readonly GuideLogEntry[];
  readonly busy: boolean;
  /** Erro da última ação (com o detalhe do daemon, se houver); some quando o cartão muda por outro motivo. */
  readonly error: GuideError | null;
  readonly run: (action: GuideActionId) => void;
  readonly submit: (form: GuideForm, values: FormValues) => Promise<boolean>;
}

const LOG_LIMIT = 50;

/** Liga snapshot → roteiro → ações (spec guia §6). O roteiro é puro; aqui só mora o estado da sessão. */
export function useGuide({ snap, setupCompleted, go, openAccount }: UseGuideOptions): UseGuide {
  const i18n = useI18n();
  const [ui, setUi] = useState<GuideUi>(INITIAL_UI);
  const [log, setLog] = useState<readonly GuideLogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GuideError | null>(null);

  // Concluída uma vez, fica concluída (spec guia §2): o daemon guarda no banco dele, então outro TAPFLOCK_DATA_DIR
  // começa do zero. Um pedido por sessão; se falhar, o checklist volta a derivar do snapshot, sem travar nada.
  const progress = useMemo(() => guideProgress({ setupCompleted, snap, alreadyCompleted: snap?.guide?.completed ?? false }), [setupCompleted, snap]);
  const marking = useRef(false);
  useEffect(() => {
    if (marking.current || !shouldMarkCompleted(snap, progress)) return;
    marking.current = true;
    void window.tapflock?.api?.('PUT', '/settings/guide', { completed: true })
      .catch((e: unknown) => { marking.current = false; console.warn('[guia] não deu para marcar a configuração concluída:', e); });
  }, [snap, progress]);
  const step = useMemo(() => nextGuideStep(progress, snap, ui), [progress, snap, ui]);

  // Refs: as ações nascem uma vez e leem sempre o estado mais novo.
  const latest = useRef({ snap, progress, i18n, go, openAccount });
  latest.current = { snap, progress, i18n, go, openAccount };

  const pushLog = useCallback((e: GuideLogEntry) => setLog((l) => [...l, e].slice(-LOG_LIMIT)), []);
  const actions = useMemo(() => createGuideActions({
    getBridge: () => window.tapflock,
    getLocale: () => latest.current.i18n.locale,
    testGoalText: () => latest.current.i18n.t('guide.test.goal'),
    setUi: (patch) => setUi((u) => ({ ...u, ...patch })),
    log: pushLog,
    go: (target) => latest.current.go(target),
    openAccount: (id) => latest.current.openAccount(id),
  }), [pushLog]);

  // Cartão novo, erro velho some; menos quando foi a própria falha que trocou o cartão (ex.: planejar o teste voltou
  // ao início): erro e cartão chegam no mesmo render, e o erro precisa ficar à vista.
  const errorFresh = useRef(false);
  useEffect(() => {
    if (errorFresh.current) return;
    setError(null);
  }, [step.id]);
  useEffect(() => { errorFresh.current = false; }, [error, step.id]);
  const fail = useCallback((message: string, detail?: string) => {
    errorFresh.current = true;
    setError({ message, detail: detail ?? null });
  }, []);

  // Marco que fecha vira linha no registro (só a transição vista nesta sessão, não o que já estava feito).
  const seen = useRef<GuideProgress['milestones'] | null>(null);
  useEffect(() => {
    // Só conta a partir do primeiro snapshot: o que já estava feito ao abrir o app não é novidade.
    if (!snap) return;
    const prev = seen.current;
    seen.current = progress.milestones;
    if (!prev) return;
    progress.milestones.forEach((m, i) => {
      if (i > 0 && m === 'done' && prev[i] !== 'done') pushLog({ ok: true, key: `guide.log.milestone.${i}` as MessageKey });
    });
  }, [progress.milestones, snap, pushLog]);

  const ctx = () => ({ snap: latest.current.snap, account: latest.current.progress.account });
  const run = useCallback((action: GuideActionId) => {
    setBusy(true); setError(null);
    void actions.run(action, ctx()).then((r) => { if (!r.ok) fail(r.error, r.detail); }).finally(() => setBusy(false));
  }, [actions, fail]);
  const submit = useCallback(async (form: GuideForm, values: FormValues) => {
    setBusy(true); setError(null);
    try {
      const r = await actions.submit(form, values, ctx());
      if (!r.ok) fail(r.error, r.detail);
      return r.ok;
    } finally { setBusy(false); }
  }, [actions, fail]);

  return { progress, step, log, busy, error, run, submit };
}
