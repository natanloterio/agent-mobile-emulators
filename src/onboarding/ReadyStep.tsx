import { BaseAvdGuide } from '../components/BaseAvdGuide';
import { baseBlocksProvision, baseStage } from '../components/baseAvdStage';
import { Heading } from '../components/Heading';
import { useI18n } from '../i18n/I18nProvider';
import type { MessageKey } from '../i18n/messages';
import { useBaseAvd } from '../live/useLiveFleet';
import type { OnboardingState } from './reducer';
import { needsLocal } from './view';

export function ReadyStep({ state, onCreate }: { readonly state: OnboardingState; readonly onCreate: () => void }) {
  const { t } = useI18n();
  // Sem o celular-base o botão "Criar identidade" levaria a um erro: o próximo passo real é prepará-lo.
  const base = useBaseAvd();
  const stage = baseStage(base, false);
  const baseMissing = baseBlocksProvision(stage);
  const items = [
    t('onboarding.ready.android'),
    t('onboarding.ready.kvm'),
    needsLocal(state.mode) ? t('onboarding.ready.local', { model: state.model }) : t('onboarding.ready.cloud'),
    t('onboarding.ready.mode', { mode: t(`onboarding.mode.${state.mode}` as MessageKey) }),
    t('onboarding.ready.keyring'),
  ];
  return (
    <>
      <header className="onb-head">
        <Heading size="h2">{t(baseMissing ? 'onboarding.ready.titleBase' : 'onboarding.ready.title')}</Heading>
        <p className="onb-lede">{t(baseMissing ? 'onboarding.ready.ledeBase' : 'onboarding.ready.lede')}</p>
      </header>
      <div className="onb-ready">
        <div className="card card--grey">
          <span className="onb-label">{t('onboarding.ready.done')}</span>
          <ul className="onb-checklist">{items.map((i) => <li key={i}>{i}</li>)}</ul>
        </div>
        <div className="card card--dark card--shadow onb-next">
          <span className="onb-label onb-label--green">{t('onboarding.ready.next')}</span>
          <h3>{t(baseMissing ? 'identities.base.blocked' : 'onboarding.ready.nextTitle')}</h3>
          <p>{t(baseMissing ? 'onboarding.ready.nextBase' : 'onboarding.ready.nextText')}</p>
          <div><button type="button" className="btn btn--tertiary" onClick={onCreate}>{t(baseMissing ? 'onboarding.ready.openIds' : 'onboarding.ready.create')}</button></div>
        </div>
      </div>
      {baseMissing && base && stage && <BaseAvdGuide name={base.name} stage={stage} />}
    </>
  );
}
