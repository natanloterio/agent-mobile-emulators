import { useEffect, useRef } from 'react';
import { Button } from '../components/Button';
import { useI18n } from '../i18n/I18nProvider';
import type { MessageKey } from '../i18n/messages';
import { useDaemonError } from '../i18n/useDaemonError';
import type { BasePhase } from '../live/types';
import { GuideFormCard } from './GuideForms';
import type { MilestoneState } from './progress';
import type { GuideButton, GuideStep } from './script';
import type { UseGuide } from './useGuide';
import './Guide.css';

const PHASES: readonly BasePhase[] = ['avd', 'boot', 'mcp', 'google', 'app', 'finish'];
const VARIANT = { primary: 'primary', secondary: 'secondary', ghost: 'ghost' } as const;

/** Erros do Guia são chaves `guide.*`; o resto é texto do daemon, traduzido quando conhecido. */
export function useGuideError(): (raw: string) => string {
  const { t } = useI18n();
  const te = useDaemonError();
  return (raw) => (raw.startsWith('guide.') ? t(raw as MessageKey) : te(raw));
}

function Phases({ current, progress }: { readonly current: BasePhase | null; readonly progress: number | null }) {
  const { t } = useI18n();
  const at = current ? PHASES.indexOf(current) : -1;
  return (
    <ol className="guide-phases">
      {PHASES.map((p, i) => (
        <li key={p} className={i < at ? 'is-done' : i === at ? 'is-now' : undefined} aria-current={i === at ? 'step' : undefined}>
          <span aria-hidden="true" className="guide-phases__mark">{i < at ? '✓' : i === at ? '●' : '○'}</span>
          {t(`identities.prep.phase.${p}` as MessageKey)}
          {i === at && progress !== null && progress < 100 && <span> · {progress}%</span>}
        </li>
      ))}
    </ol>
  );
}

function Buttons({ buttons, busy, onRun }: { readonly buttons: readonly GuideButton[]; readonly busy: boolean; readonly onRun: (b: GuideButton) => void }) {
  const { t } = useI18n();
  if (!buttons.length) return null;
  return (
    <div className="guide-card__actions">
      {buttons.map((b) => (
        <Button key={b.id} size="sm" variant={VARIANT[b.variant]} disabled={busy} onClick={() => onRun(b)}>
          {t(b.label)}
        </Button>
      ))}
    </div>
  );
}

/** Cartão do passo atual (spec guia §3.5): o `id` da situação é a `key`, então o foco vai para o cartão novo. */
function StepCard({ step, guide }: { readonly step: GuideStep; readonly guide: UseGuide }) {
  const { t } = useI18n();
  const ge = useGuideError();
  const ref = useRef<HTMLDivElement>(null);
  // Só puxa o foco se ele já estava no painel: um snapshot novo não pode tirar a pessoa do que ela digita na tela.
  useEffect(() => {
    const at = document.activeElement;
    if (!at || at === document.body || at.closest('#guide-panel')) ref.current?.focus({ preventScroll: true });
  }, []);
  const human = step.kind === 'human';
  const kicker = human ? t('guide.yourTurn') : step.milestone !== null ? t('guide.step', { n: step.milestone + 1 }) : null;
  const params = step.params;
  return (
    <div
      ref={ref} tabIndex={-1} role={human ? 'alert' : undefined}
      className={`guide-card guide-card--${step.kind}`} aria-labelledby={`guide-step-${step.id}`}
    >
      {kicker && <span className="guide-card__kicker">{kicker}</span>}
      <h3 className="guide-card__title" id={`guide-step-${step.id}`}>{t(step.title, params)}</h3>
      {step.body && <p className="guide-card__body">{t(step.body, params)}</p>}
      {step.detail && <p className="guide-card__detail">{ge(step.detail)}</p>}
      {step.kind === 'progress' && !step.phases && <div className="guide-card__spinner" aria-hidden="true" />}
      {step.phases && <Phases current={step.phases.current} progress={step.phases.progress} />}
      {step.form ? (
        <GuideFormCard form={step.form} busy={guide.busy} onSubmit={guide.submit}>
          {step.buttons.map((b) => (
            <Button key={b.id} size="sm" variant={VARIANT[b.variant]} disabled={guide.busy} onClick={() => guide.run(b.id)}>{t(b.label)}</Button>
          ))}
        </GuideFormCard>
      ) : (
        <Buttons buttons={step.buttons} busy={guide.busy} onRun={(b) => guide.run(b.id)} />
      )}
      {guide.error && (
        <div className="guide-card__error" role="alert">
          <p>{ge(guide.error.message)}</p>
          {guide.error.detail && <p className="guide-card__errdetail">{ge(guide.error.detail)}</p>}
        </div>
      )}
    </div>
  );
}

const DOT: Readonly<Record<MilestoneState, string>> = { todo: '', doing: 'is-now', 'needs-you': 'is-now', done: 'is-done', failed: 'is-failed' };

/** Painel do Guia (spec guia §3): à direita no desktop, bottom sheet no mobile. */
export function GuidePanel({ guide, isMobile, onClose }: { readonly guide: UseGuide; readonly isMobile: boolean; readonly onClose: () => void }) {
  const { t } = useI18n();
  const { progress, step, log } = guide;
  const done = progress.milestones.filter((m) => m === 'done').length;
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [log.length, step.id]);

  return (
    // Esc só vale dentro do painel: em outro campo ou diálogo da tela ele é de quem está com o foco.
    <aside
      className={`guide${isMobile ? ' guide--sheet' : ''}`} id="guide-panel" aria-labelledby="guide-title"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
    >
      {isMobile && <span className="guide__grab" aria-hidden="true" />}
      <header className="guide__head">
        <h2 className="guide__title" id="guide-title">{t('guide.title')}</h2>
        <button type="button" className="guide__close" aria-label={t('guide.close')} onClick={onClose}>✕</button>
      </header>
      <div className="guide__progress">
        {progress.current === null ? (
          <span>{t('guide.checklist.complete')} ✓</span>
        ) : (
          <>
            <span className="guide__dots" aria-hidden="true">
              {progress.milestones.map((m, i) => <i key={i} className={DOT[m]} />)}
            </span>
            <span>{t('guide.checklist.count', { done })} · <b>{t('guide.now', { step: t(`guide.now.${progress.current}` as MessageKey) })}</b></span>
          </>
        )}
      </div>
      <div className="guide__body" ref={logRef}>
        {log.length > 0 && (
          <ul className="guide__log" aria-label={t('guide.log.title')}>
            {log.map((e, i) => (
              <li key={i}><span aria-hidden="true">{e.ok ? '✓' : '✕'}</span>{t(e.key, e.params)}</li>
            ))}
          </ul>
        )}
        <div aria-live="polite">
          <StepCard key={step.id} step={step} guide={guide} />
        </div>
      </div>
    </aside>
  );
}
