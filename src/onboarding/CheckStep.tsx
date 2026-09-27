import { useState } from 'react';
import { Heading } from '../components/Heading';
import { useI18n } from '../i18n/I18nProvider';
import type { MessageKey } from '../i18n/messages';
import { RAM_PER_EMULATOR_GIB } from './catalog';
import type { OnboardingState } from './reducer';
import type { UserFix } from './schema';
import { depRows, emulatorCapacity, formatMb, summarize, type DepRow } from './view';

const KVM_CMD = 'sudo usermod -aG kvm $USER';
const WHPX_CMD = 'Enable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform';
const ICON: Readonly<Record<DepRow['state'], string>> = { ok: '✓', todo: '↓', user: '!' };
const PILL: Readonly<Record<DepRow['state'], string>> = { ok: 'pill pill--green', todo: 'pill pill--white', user: 'pill pill--dark' };

function CopyCommand({ cmd }: { readonly cmd: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard?.writeText(cmd).then(() => setCopied(true), () => undefined); };
  return (
    <div className="onb-cmd">
      <code>{cmd}</code>
      <button type="button" className="btn btn--secondary btn--sm" onClick={copy}>{copied ? t('onboarding.fix.copied') : t('onboarding.fix.copy')}</button>
    </div>
  );
}

function Fix({ fix, onRecheck }: { readonly fix: UserFix; readonly onRecheck: () => void }) {
  const { t } = useI18n();
  return (
    <div className="onb-fix">
      <span>{t(`onboarding.fix.${fix}` as MessageKey)}</span>
      {fix === 'kvm-group' && <CopyCommand cmd={KVM_CMD} />}
      {fix === 'whpx-off' && <CopyCommand cmd={WHPX_CMD} />}
      <div><button type="button" className="btn btn--secondary btn--sm" onClick={onRecheck}>{t('onboarding.check.retry')}</button></div>
    </div>
  );
}

export function CheckStep({ state, onRecheck }: { readonly state: OnboardingState; readonly onRecheck: () => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const head = (
    <header className="onb-head">
      <Heading size="h2">{t('onboarding.check.title')}</Heading>
      <p className="onb-lede">{t('onboarding.check.lede')}</p>
    </header>
  );
  if (!state.report) {
    return (
      <>
        {head}
        <div className="card card--grey onb-loading">
          {state.checkError ? t('onboarding.check.failed', { error: state.checkError }) : t('onboarding.check.loading')}
          {state.checkError && <div><button type="button" className="btn btn--secondary btn--sm" onClick={onRecheck}>{t('onboarding.check.retry')}</button></div>}
        </div>
      </>
    );
  }
  const rows = depRows(state.report, state.mode, state.model);
  const sum = summarize(rows);
  const hw = state.report.hardware;
  const cap = emulatorCapacity(hw);
  const detail = (r: DepRow) => (r.state === 'ok' ? r.version ?? '' : r.sizeMb ? formatMb(r.sizeMb, i18n) : '');
  const name = (r: DepRow) => t(`onboarding.dep.${r.id}` as MessageKey, { model: state.model });

  return (
    <>
      {head}
      <div className="onb-summary">
        <div className="onb-stat onb-stat--ok"><span className="onb-label">{t('onboarding.summary.ok')}</span><b>{sum.ok}</b><span>{t('onboarding.summary.okOf', { total: sum.total })}</span></div>
        <div className="onb-stat"><span className="onb-label">{t('onboarding.summary.todo')}</span><b>{sum.todo}</b><span>{t('onboarding.summary.download', { size: formatMb(sum.downloadMb, i18n) })}</span></div>
        <div className={`onb-stat${sum.user ? ' onb-stat--user' : ''}`}><span className="onb-label">{t('onboarding.summary.user')}</span><b>{sum.user}</b><span>{sum.user ? t('onboarding.summary.userSome') : t('onboarding.summary.userNone')}</span></div>
      </div>
      <div className="onb-deps">
        {rows.map((r) => (
          <div className="onb-dep" data-s={r.state} key={r.id}>
            <span className="onb-dep__ico" aria-hidden="true">{ICON[r.state]}</span>
            <div><h3>{name(r)}</h3><p>{t(`onboarding.dep.${r.id}.role` as MessageKey)}</p></div>
            <div className="onb-dep__meta"><span className={PILL[r.state]}>{t(`onboarding.state.${r.state}` as MessageKey)}</span><span className="onb-mono">{detail(r)}</span></div>
            {r.state === 'user' && r.fix && <Fix fix={r.fix} onRecheck={onRecheck} />}
          </div>
        ))}
      </div>
      <div className="card card--dark onb-hw">
        <div>
          <span className="onb-label onb-label--dark">{t('onboarding.hw.title')}</span>
          <dl>
            <dt>{t('onboarding.hw.ram')}</dt><dd>{`${i18n.fmt.decimal(hw.ramGiB, 0)} GB`}</dd>
            <dt>{t('onboarding.hw.cpu')}</dt><dd>{t('onboarding.hw.cpuValue', { threads: hw.threads, model: hw.cpuModel })}</dd>
            <dt>{t('onboarding.hw.gpu')}</dt><dd>{hw.gpu ? (hw.gpu.unified ? `${hw.gpu.name} · ${t('onboarding.hw.unified')}` : `${hw.gpu.name} · ${i18n.fmt.decimal(hw.gpu.totalGiB, 0)} GB`) : t('onboarding.hw.gpuNone')}</dd>
            <dt>{t('onboarding.hw.disk')}</dt><dd>{`${i18n.fmt.decimal(hw.diskFreeGiB, 0)} GB`}</dd>
          </dl>
        </div>
        <div className="onb-cap">
          <span className="onb-label onb-label--dark">{t('onboarding.hw.capacity')}</span>
          <b>{cap.count}</b>
          <div className="onb-phones" aria-hidden="true">
            {Array.from({ length: Math.max(cap.count, 12) }, (_, i) => <i key={i} className={i < cap.count ? 'on' : ''} />)}
          </div>
          <span className="onb-cap__note">{t('onboarding.hw.capacityNote', { ram: `${i18n.fmt.decimal(RAM_PER_EMULATOR_GIB)} GB` })} {t(`onboarding.hw.limit.${cap.limit}` as MessageKey)}</span>
        </div>
      </div>
    </>
  );
}
