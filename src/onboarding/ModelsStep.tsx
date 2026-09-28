import { Heading } from '../components/Heading';
import { useI18n } from '../i18n/I18nProvider';
import type { MessageKey } from '../i18n/messages';
import { LOCAL_MODELS, MODE_ROLES, MODES, type SetupMode } from './catalog';
import type { OnboardingState } from './reducer';
import { defaultMode, modelEntry, modelFit, needsLocal, vramBar } from './view';

const ROLE_KEYS: readonly MessageKey[] = ['onboarding.role.lider', 'onboarding.role.worker', 'onboarding.role.esc'];

export interface ModelsStepProps {
  readonly state: OnboardingState;
  readonly onMode: (m: SetupMode) => void;
  readonly onModel: (id: string) => void;
  readonly onKey: (key: string) => void;
  readonly onTestKey: () => void;
}

export function ModelsStep({ state, onMode, onModel, onKey, onTestKey }: ModelsStepProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const gpu = state.report?.hardware.gpu ?? null;
  const recommended: SetupMode = defaultMode(gpu);
  const current = modelEntry(state.model) ?? LOCAL_MODELS[0];
  const bar = vramBar(current, gpu);
  const gb = (n: number) => `${i18n.fmt.decimal(n)} GB`;
  const keyMsg: Partial<Record<OnboardingState['keyTest'], MessageKey>> = { ok: 'onboarding.key.ok', invalid: 'onboarding.key.invalid', network: 'onboarding.key.network' };

  return (
    <>
      <header className="onb-head">
        <Heading size="h2">{t('onboarding.models.title')}</Heading>
        <p className="onb-lede">{t('onboarding.models.lede')}</p>
      </header>
      <div className="onb-modes" role="radiogroup" aria-label={t('onboarding.models.title')}>
        {MODES.map((m) => (
          <button type="button" key={m} role="radio" aria-checked={state.mode === m} className="onb-mode" onClick={() => onMode(m)}>
            {m === recommended ? <span className="pill pill--dark">{t('onboarding.mode.recommended')}</span> : <span className="onb-mode__spacer" />}
            <h3>{t(`onboarding.mode.${m}` as MessageKey)}</h3>
            <p>{t(`onboarding.mode.${m}.text` as MessageKey)}</p>
            <div className="onb-mode__roles">
              {MODE_ROLES[m].map((where, i) => (
                <span className="pill pill--white" key={ROLE_KEYS[i]}>{t(ROLE_KEYS[i])}: {t(where === 'cloud' ? 'onboarding.role.cloud' : 'onboarding.role.local')}</span>
              ))}
            </div>
          </button>
        ))}
      </div>
      <div className={needsLocal(state.mode) ? 'onb-two' : ''}>
        {needsLocal(state.mode) && (
          <div className="card onb-local">
            <span className="onb-label">{t('onboarding.models.localTitle')}</span>
            <div className="onb-models" role="radiogroup" aria-label={t('onboarding.models.localTitle')}>
              {LOCAL_MODELS.map((m) => {
                const fit = modelFit(m, gpu);
                const installed = state.report?.localModels.includes(m.id) ?? false;
                return (
                  <button type="button" key={m.id} role="radio" aria-checked={state.model === m.id} aria-disabled={fit === 'too-big'} className="onb-model" onClick={() => onModel(m.id)}>
                    <span className="onb-radio" aria-hidden="true" />
                    <div>
                      <h4>
                        <span className="onb-mono">{m.id}</span>
                        {m.recommended && <span className="pill pill--green">{t('onboarding.model.recommended')}</span>}
                        {installed && <span className="pill pill--grey">{t('onboarding.model.installed')}</span>}
                        {fit === 'too-big' && <span className="pill pill--grey">{t('onboarding.model.tooBig')}</span>}
                        {fit === 'tight' && <span className="pill pill--grey">{t('onboarding.model.tight')}</span>}
                      </h4>
                      <p>{fit === 'cpu' ? t('onboarding.model.cpu') : t(m.noteKey)}</p>
                    </div>
                    <span className="onb-model__size">{gb(m.sizeGb)}<small>{t('onboarding.model.vram', { size: gb(m.vramGb) })}</small></span>
                  </button>
                );
              })}
            </div>
            {bar && (
              <div className="onb-vram">
                <span className="onb-label">{t('onboarding.vram.title')}</span>
                <div className="onb-vram__bar" aria-hidden="true">
                  <span style={{ width: `${bar.systemPct}%` }} className="onb-vram__sys" />
                  <span style={{ width: `${bar.modelPct}%` }} className="onb-vram__model" />
                </div>
                <div className="onb-vram__legend">
                  <span><i className="onb-vram__sys" />{t('onboarding.vram.system', { size: gb(1.2) })}</span>
                  <span><i className="onb-vram__model" />{t('onboarding.vram.model', { model: current.id, size: gb(current.vramGb) })}</span>
                  <span><i />{t('onboarding.vram.free', { free: gb(bar.freeGiB), total: gb(bar.totalGiB) })}</span>
                </div>
              </div>
            )}
          </div>
        )}
        {state.mode === 'local' ? (
          <div className="card card--grey"><p className="onb-note">{t('onboarding.key.localOnly')}</p></div>
        ) : (
          <div className="card card--grey onb-key">
            <label htmlFor="onb-apikey">{t('onboarding.key.label')}</label>
            <input id="onb-apikey" type="password" placeholder="sk-ant-…" autoComplete="off" value={state.apiKey} onChange={(e) => onKey(e.target.value)} />
            <small>{t('onboarding.key.help')}</small>
            <div className="onb-key__row">
              <button type="button" className="btn btn--secondary btn--sm" disabled={!state.apiKey.trim() || state.keyTest === 'busy'} onClick={onTestKey}>
                {state.keyTest === 'busy' ? t('onboarding.key.testing') : t('onboarding.key.test')}
              </button>
              {keyMsg[state.keyTest] && <span role="status" className={state.keyTest === 'ok' ? 'onb-ok' : 'onb-bad'}>{t(keyMsg[state.keyTest]!)}</span>}
            </div>
            {!state.apiKey.trim() && <small>{t(state.report?.keyConfigured ? 'onboarding.key.alreadySaved' : state.mode === 'nuvem' ? 'onboarding.key.emptyCloud' : 'onboarding.key.empty')}</small>}
          </div>
        )}
      </div>
    </>
  );
}
