import { Heading } from '../components/Heading';
import { useI18n } from '../i18n/I18nProvider';
import type { MessageKey } from '../i18n/messages';
import type { OnboardingState } from './reducer';
import type { JobEvent, JobId } from './schema';
import { depRows, formatMb, installTotals, jobsToInstall, sizesOf } from './view';

const PILL: Readonly<Record<JobEvent['state'], string>> = { wait: 'pill pill--grey', run: 'pill pill--white', done: 'pill pill--green', err: 'pill onb-pill--err' };

export interface InstallStepProps { readonly state: OnboardingState; readonly onRetry: () => void; readonly onOtherModel: () => void }

export function InstallStep({ state, onRetry, onOtherModel }: InstallStepProps) {
  const i18n = useI18n();
  const { t } = i18n;
  if (!state.report) return null;
  const rows = depRows(state.report, state.mode, state.model);
  const jobs = jobsToInstall(rows);
  const sizes = sizesOf(rows);
  const totals = installTotals(jobs, state.jobs, sizes);
  const nameOf = (id: JobId) => t(`onboarding.dep.${id}` as MessageKey, { model: state.model });

  return (
    <>
      <header className="onb-head">
        <Heading size="h2">{t('onboarding.install.title')}</Heading>
        <p className="onb-lede">{t('onboarding.install.lede')}</p>
      </header>
      <div className="onb-total">
        <b>{formatMb(totals.doneMb, i18n)}</b>
        <span>{t('onboarding.install.of', { total: formatMb(totals.totalMb, i18n), done: totals.doneCount, count: totals.count })}</span>
      </div>
      {jobs.length === 0 && <div className="card card--grey">{t('onboarding.install.nothing')}</div>}
      <div className="onb-jobs">
        {jobs.map((id) => {
          const ev: JobEvent = state.jobs[id] ?? { id, state: 'wait', doneMb: 0, totalMb: sizes[id] ?? 0, error: null };
          const total = ev.totalMb || sizes[id] || 0;
          const pct = total ? Math.min(100, (ev.doneMb / total) * 100) : 0;
          return (
            <div className="onb-job" data-s={ev.state} key={id}>
              <div className="onb-job__top"><h3>{nameOf(id)}</h3><span className={PILL[ev.state]}>{t(`onboarding.job.${ev.state}` as MessageKey)}</span></div>
              <div className="onb-prog" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /></div>
              <div className="onb-job__top">
                <span className="onb-nums">{t('onboarding.job.progress', { done: formatMb(ev.doneMb, i18n), total: formatMb(total, i18n) })}</span>
                {id === 'ollama' && ev.state !== 'done' && <span className="onb-nums">{t('onboarding.install.ollamaNote')}</span>}
              </div>
              {ev.state === 'err' && ev.error && (
                <div className="onb-err">
                  <strong>{t(`onboarding.err.${ev.error.kind}.title` as MessageKey)}</strong>
                  <p>{t(`onboarding.err.${ev.error.kind}` as MessageKey, { message: ev.error.message })}</p>
                  <div className="onb-err__row">
                    <button type="button" className="btn btn--primary btn--sm" onClick={onRetry}>{t('onboarding.err.retry')}</button>
                    {id === 'model' && <button type="button" className="btn btn--secondary btn--sm" onClick={onOtherModel}>{t('onboarding.err.otherModel')}</button>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {state.installError && <div className="onb-err"><p>{state.installError}</p><div><button type="button" className="btn btn--primary btn--sm" onClick={onRetry}>{t('onboarding.err.retry')}</button></div></div>}
      <details className="onb-details">
        <summary>{t('onboarding.install.details')}</summary>
        <pre className="onb-log">{state.log.join('\n')}</pre>
      </details>
    </>
  );
}
