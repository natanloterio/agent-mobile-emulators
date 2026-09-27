import { useEffect } from 'react';
import { Heading } from '../components/Heading';
import { useI18n } from '../i18n/I18nProvider';
import type { GpuBarView } from '../lib/gpuBar';
import type { ProviderPatch } from '../live/types';
import type { RoleVM } from '../state/selectors';
import type { ProviderMode, RoleKey } from '../types/fleet';
import { BudgetsCard, type BudgetsCardProps } from './BudgetsCard';
import { shouldSubmitEndpoint } from './endpointSubmit';
import { cardError, localSelect, modelChoice, roleRuntime, runtimeLines } from './localModels';
import { VramPanel } from './VramPanel';
import './Providers.css';

interface ProvidersProps {
  readonly roles: readonly RoleVM[];
  readonly fleetSize: number;
  readonly kvLeft: string;
  readonly vramEmuShare: string;
  /** VRAM total medida pelo host (vivo) ou a do design. */
  readonly vramTotal: string;
  /** Ocupação real da GPU (vivo com `host.gpu`); null mantém o quadro estimado. */
  readonly gpu: GpuBarView | null;
  readonly isMobile: boolean;
  readonly onPickMode: (role: RoleKey, mode: ProviderMode) => void;
  readonly onTest: (role: RoleKey) => void;
  readonly onSetField: (role: RoleKey, patch: Omit<ProviderPatch, 'mode'>) => void;
  readonly onLoadModels: (role: RoleKey) => void;
  /** Cartão "Limites dos agentes" (spec limites §UI): só no modo vivo (`null` esconde, como no demo). */
  readonly budgets: BudgetsCardProps | null;
}

const MODES: readonly ProviderMode[] = ['nuvem', 'local'];

export function Providers({ roles, fleetSize, kvLeft, vramEmuShare, vramTotal, gpu, isMobile, onPickMode, onTest, onSetField, onLoadModels, budgets }: ProvidersProps) {
  // Recarrega a lista de modelos quando a tela abre e quando algum papel troca de modo.
  const { t } = useI18n();
  const modeKey = roles.map((r) => `${r.key}:${r.mode}`).join('|');
  useEffect(() => { roles.forEach((r) => onLoadModels(r.key)); }, [modeKey]);

  return (
    <div className="screen">
      <header className="screen__title">
        <Heading size={isMobile ? 'h3' : 'h2'}>{t('providers.title')}</Heading>
        <p className="screen__lede">{t('providers.lede')}</p>
      </header>

      <div className="roles">
        {roles.map((r) => (
          <div className={`card card--${r.tone} card--shadow role`} key={r.key}>
            <div className="role__head"><span className="role__name">{r.name}</span><span className="role__volume">{r.volume}</span></div>
            <div className="role__toggle" role="radiogroup" aria-label={t('providers.role.aria', { role: r.name })}>
              {MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={r.mode === m}
                  className={`role__mode${r.mode === m ? ' role__mode--active' : ''}`}
                  onClick={() => onPickMode(r.key, m)}
                >
                  {t(`providers.mode.${m}`)}
                </button>
              ))}
            </div>
            {r.mode === 'local' && r.catalog ? <LocalModelField role={r} onSetField={onSetField} /> : (
              <label className="role__field"><span>{t('providers.field.model')}</span>
                <select className="role__select" value={r.model} onChange={(e) => onSetField(r.key, { model: e.target.value })} aria-label={t('providers.model.aria', { role: r.name })}>
                  {(r.models.includes(r.model) ? r.models : [r.model, ...r.models]).map((m) => (
                    <option key={m} value={m}>{m === r.model && !r.models.includes(m) ? t('providers.model.current', { model: m }) : m}</option>
                  ))}
                </select>
              </label>
            )}
            {r.mode === 'local' ? (
              <label className="role__field"><span>{t('providers.field.endpoint')}</span>
                <input className="role__input" defaultValue={r.endpoint} key={r.endpoint} aria-label={t('providers.endpoint.aria', { role: r.name })}
                  onBlur={(e) => { if (shouldSubmitEndpoint(e.target.value, r.endpoint, r.putError)) onSetField(r.key, { endpoint: e.target.value }); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
              </label>
            ) : (
              <div className="role__field"><span>{t('providers.field.endpoint')}</span><div className="role__box role__box--mono">{r.endpoint}</div></div>
            )}
            {(() => {
              // Com catálogo, o erro de um runtime já aparece na linha dele: o card não o repete.
              const error = r.mode === 'local' && r.catalog ? cardError(r.error, r.putError, r.catalog.runtimes) : r.error;
              return error && <div className="role__error" role="alert">{error}</div>;
            })()}
            <button
              type="button"
              className={`role__test${r.key === 'esc' ? ' role__test--green' : ''}`}
              onClick={() => onTest(r.key)}
              disabled={r.testing}
            >
              {r.testLabel}
            </button>
            {r.result && (
              <div className="role__result">
                {r.result.map((x) => (
                  <div className="role__result-row" key={x.label}><span>{x.label}</span><b>{x.value}</b></div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {budgets && <BudgetsCard {...budgets} />}

      <VramPanel gpu={gpu} fleetSize={fleetSize} kvLeft={kvLeft} vramEmuShare={vramEmuShare} vramTotal={vramTotal} />
    </div>
  );
}

/** Seletor do papel local com o catálogo do daemon: modelos baixados por runtime e uma linha de status por runtime. */
function LocalModelField({ role: r, onSetField }: { readonly role: RoleVM; readonly onSetField: ProvidersProps['onSetField'] }) {
  const i18n = useI18n();
  const { t } = i18n;
  if (!r.catalog) return null;
  const runtime = roleRuntime(r.runtime, r.endpoint);
  const vm = localSelect(r.catalog, runtime, r.model, i18n);
  const lines = runtimeLines(r.catalog.runtimes, i18n);
  return (
    <>
      <label className="role__field"><span>{t('providers.field.model')}</span>
        <select className="role__select" value={vm.value} aria-label={t('providers.model.aria', { role: r.name })}
          onChange={(e) => { if (e.target.value !== vm.value) onSetField(r.key, modelChoice(e.target.value, runtime)); }}>
          {vm.orphan && <option value={vm.orphan.value}>{vm.orphan.label}</option>}
          {vm.groups.map((g) => (
            <optgroup key={g.runtime} label={g.label}>
              {g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      {lines.length > 0 && (
        <ul className="role__runtimes" aria-label={t('providers.runtime.aria')}>
          {lines.map((l) => (
            <li key={l.kind} className={`role__runtime${l.kind === runtime ? ' role__runtime--current' : ''}`}>
              <span>{l.text}</span>
              {l.error && <span className="role__runtime-error">{l.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
