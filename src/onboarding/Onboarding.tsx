import { Button } from '../components/Button';
import { DaemonBanner } from '../components/DaemonBanner';
import { LanguageSelect } from '../components/LanguageSelect';
import { Logo } from '../components/Logo';
import { useI18n } from '../i18n/I18nProvider';
import type { MessageKey } from '../i18n/messages';
import { useDaemonStatus } from '../live/daemonStatus';
import type { SetupBridge } from '../live/types';
import { CheckStep } from './CheckStep';
import { InstallStep } from './InstallStep';
import { ModelsStep } from './ModelsStep';
import { ReadyStep } from './ReadyStep';
import type { Step } from './reducer';
import { useOnboarding } from './useOnboarding';
import { footerView } from './view';
import './Onboarding.css';

const STEPS: readonly { readonly title: MessageKey; readonly sub: MessageKey }[] = [
  { title: 'onboarding.step.check', sub: 'onboarding.step.check.sub' },
  { title: 'onboarding.step.models', sub: 'onboarding.step.models.sub' },
  { title: 'onboarding.step.install', sub: 'onboarding.step.install.sub' },
  { title: 'onboarding.step.ready', sub: 'onboarding.step.ready.sub' },
];

export interface OnboardingProps {
  readonly bridge: SetupBridge;
  readonly onDone: (screen: 'cockpit' | 'guide') => void;
  /** Presente só quando reaberto em Provedores: volta ao app sem aplicar nada. */
  readonly onClose?: () => void;
}

/** Onboarding de primeira execução (spec onboarding, mockup design/onboarding.html). */
export function Onboarding({ bridge, onDone, onClose }: OnboardingProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const { state, actions } = useOnboarding(bridge, !onClose);
  const footer = footerView(state, i18n);
  // O fim do onboarding sobe o daemon: se foi ele que falhou, o motivo traduzido vale mais que o texto cru do erro.
  const daemon = useDaemonStatus();
  const daemonFailed = state.step === 2 && state.finishError && daemon.status?.state === 'failed' ? daemon.status : null;
  // Só dá para voltar a passos anteriores; o passo 4 só chega pelo fim da instalação.
  const canJump = (i: number) => i < state.step && !state.installing && !state.finishing && state.step < 3;

  return (
    <div className="onb">
      <aside className="onb__rail">
        <div className="onb__logo"><Logo size={36} /><span>TapFlock</span></div>
        <ol className="onb__steps">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <button
                type="button"
                className={`onb__step${i < state.step ? ' onb__step--done' : ''}`}
                aria-current={i === state.step ? 'step' : undefined}
                disabled={!canJump(i) && i !== state.step}
                onClick={() => canJump(i) && actions.go(i as Step)}
              >
                <span className="onb__num">{i < state.step ? '✓' : i + 1}</span>
                <span>{t(s.title)}<span className="onb__sub">{t(s.sub)}</span></span>
              </button>
            </li>
          ))}
        </ol>
        <div className="onb__railnote">
          <span>{t('onboarding.rail.firstRun')}</span>
          <span>{t('onboarding.rail.redo')}</span>
        </div>
        {/* Primeira tela que qualquer pessoa vê: o idioma se troca aqui mesmo, não só depois, dentro do app. */}
        <div className="onb__lang"><LanguageSelect /></div>
      </aside>
      <div className="onb__main">
        <div className="onb__content">
          {daemonFailed && <DaemonBanner status={daemonFailed} retrying={state.finishing} onRetry={actions.next} />}
          {state.step === 0 && <CheckStep state={state} onRecheck={() => void actions.check()} />}
          {state.step === 1 && <ModelsStep state={state} onMode={actions.pickMode} onModel={actions.pickModel} onKey={actions.setKey} onTestKey={() => void actions.testKey()} />}
          {state.step === 2 && <InstallStep state={state} onRetry={() => void actions.install()} onOtherModel={() => actions.go(1)} />}
          {state.step === 3 && <ReadyStep state={state} onCreate={() => onDone('guide')} />}
        </div>
        <footer className="onb__footer">
          <span className={`onb__hint${footer.error ? ' onb__hint--error' : ''}`} role={footer.error ? 'alert' : 'status'}>{footer.hint}</span>
          <div className="onb__actions">
            {onClose && state.step < 3 && (
              <Button variant="ghost" disabled={state.installing || state.finishing} onClick={onClose}>{t('onboarding.nav.close')}</Button>
            )}
            {footer.showBack && (
              <Button variant="secondary" disabled={footer.backDisabled} onClick={() => actions.go((state.step - 1) as Step)}>{t('onboarding.nav.back')}</Button>
            )}
            <Button variant="primary" disabled={footer.disabled} onClick={() => (state.step === 3 ? onDone('cockpit') : actions.next())}>{footer.action}</Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
