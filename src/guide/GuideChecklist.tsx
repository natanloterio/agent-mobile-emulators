import { Button } from '../components/Button';
import { useI18n } from '../i18n/I18nProvider';
import type { MessageKey } from '../i18n/messages';
import type { GuideProgress, MilestoneState } from './progress';
import { HELP_BUTTON_ID } from './useGuidePanel';

const ICON: Readonly<Record<MilestoneState, string>> = { todo: '', doing: '…', 'needs-you': '!', done: '✓', failed: '✕' };

/** Checklist no topo do Cockpit enquanto a configuração não termina (spec guia §2). Estado em texto, nunca só cor. */
export function GuideChecklist({ progress, onOpen }: { readonly progress: GuideProgress; readonly onOpen: () => void }) {
  const { t } = useI18n();
  const done = progress.milestones.filter((m) => m === 'done').length;
  return (
    <section className="card card--white guide-checklist" aria-labelledby="guide-checklist-title">
      <div className="guide-checklist__head">
        <h2 className="guide-checklist__title" id="guide-checklist-title">{t('guide.checklist.title')}</h2>
        <span className="guide-checklist__count">{t('guide.checklist.count', { done })}</span>
        <Button size="sm" onClick={onOpen}>{t('guide.checklist.continue')}</Button>
      </div>
      <div className="guide-checklist__bar" role="progressbar" aria-valuemin={0} aria-valuemax={4} aria-valuenow={done} aria-label={t('guide.checklist.title')}>
        <i style={{ width: `${done * 25}%` }} />
      </div>
      <ol className="guide-checklist__steps">
        {progress.milestones.map((m, i) => (
          <li key={i} className={`guide-checklist__step is-${m}${i === progress.current ? ' is-current' : ''}`} aria-current={i === progress.current ? 'step' : undefined}>
            <span className="guide-checklist__icon" aria-hidden="true">{ICON[m] || i + 1}</span>
            <span>
              <span className="guide-checklist__label">{t(`guide.m.${i}` as MessageKey)}</span>
              <span className="guide-checklist__state">{t(`guide.state.${m}` as MessageKey)}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Botão "Ajuda" da sidebar e do topo mobile; o ponto avisa que o Guia mudou enquanto estava fechado. */
export function HelpButton({ open, unread, compact = false, onToggle }: { readonly open: boolean; readonly unread: boolean; readonly compact?: boolean; readonly onToggle: () => void }) {
  const { t } = useI18n();
  return (
    <button
      id={HELP_BUTTON_ID} type="button" className={`helpbtn${compact ? ' helpbtn--compact' : ''}`}
      aria-expanded={open} aria-controls="guide-panel" onClick={onToggle}
      aria-label={compact ? t('guide.open') : undefined}
    >
      <span className="helpbtn__icon" aria-hidden="true">?</span>
      {!compact && <span>{t('guide.open')}</span>}
      {unread && !open && <span className="helpbtn__dot"><span className="sr-only">{t('guide.newMessage')}</span></span>}
    </button>
  );
}
