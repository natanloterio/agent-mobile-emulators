import { useI18n } from '../i18n/I18nProvider';
import type { MessageKey } from '../i18n/messages';
import type { BaseStage } from './baseAvdStage';

const STEPS: readonly MessageKey[] = ['identities.base.step1', 'identities.base.step2', 'identities.base.step3', 'identities.base.step4'];
const HEAD: Readonly<Record<BaseStage, readonly [MessageKey, MessageKey]>> = {
  missing: ['identities.base.title', 'identities.base.lede'],
  running: ['identities.base.runningTitle', 'identities.base.runningLede'],
  ready: ['identities.base.readyTitle', 'identities.base.readyLede'],
};

/** Celular-base (AVD que o provisionamento clona): o que fazer, na ordem, até a primeira identidade existir. */
export function BaseAvdGuide({ name, stage }: { readonly name: string; readonly stage: BaseStage }) {
  const { t } = useI18n();
  const [title, lede] = HEAD[stage];
  return (
    <section className={`card card--white baseguide${stage === 'running' ? ' baseguide--warn' : ''}`} aria-label={t(title, { name })}>
      <h3 className="baseguide__title">{t(title, { name })}</h3>
      <p className="baseguide__lede" role={stage === 'running' ? 'status' : undefined}>{t(lede, { name })}</p>
      <ol className="baseguide__steps">
        {STEPS.map((k) => <li key={k}>{t(k, { name })}</li>)}
      </ol>
      {stage !== 'ready' && <p className="baseguide__note">{t('identities.base.auto')}</p>}
      {stage === 'missing' && <p className="baseguide__note">{t('identities.base.other')}</p>}
    </section>
  );
}
