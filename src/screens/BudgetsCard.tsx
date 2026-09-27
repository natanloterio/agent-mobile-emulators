import { useEffect, useState } from 'react';
import { Heading } from '../components/Heading';
import { useI18n } from '../i18n/I18nProvider';
import type { LocalParallelStatus } from '../live/types';
import {
  BUDGET_MAX, BUDGET_MIN, budgetFieldFrom, budgetFieldToPatchValue, clampBudgetInput, type BudgetField,
} from './budgetsField';
import { clampLocalParallelInput, LOCAL_PARALLEL_MAX, LOCAL_PARALLEL_MIN, localParallelStateKind } from './localParallelField';

export interface BudgetsCardProps {
  /** Valor atual no daemon (spec limites §UI); `null` = sem limite. */
  readonly goal: number | null;
  readonly mission: number | null;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onSave: (patch: { goal?: number | null; mission?: number | null }) => void;
  /** Paralelismo local configurável (spec paralelismo §UI); ausente esconde a linha (daemon antigo). */
  readonly localParallel?: LocalParallelStatus;
  readonly localParallelBusy?: boolean;
  readonly localParallelError?: string | null;
  readonly onSaveLocalParallel?: (parallel: number) => void;
}

// Número mostrado no campo quando o valor atual é "sem limite" (nada mais sensato para editar a partir daí);
// mesmos defaults de CONFIG.worker.stepBudget / CONFIG.mission.subtaskStepBudget.
const DEFAULT_GOAL_VISIBLE = 30;
const DEFAULT_MISSION_VISIBLE = 60;

/** Uma linha: rótulo, input numérico (1–1000) e a caixa "Sem limite". */
function BudgetRow({ label, field, onChange, ariaLabel, unlimitedLabel }: {
  readonly label: string; readonly field: BudgetField; readonly onChange: (f: BudgetField) => void;
  readonly ariaLabel: string; readonly unlimitedLabel: string;
}) {
  return (
    <label className="role__field budgets__row">
      <span>{label}</span>
      <span className="budgets__controls">
        <input
          className="role__input budgets__input"
          type="number"
          min={BUDGET_MIN}
          max={BUDGET_MAX}
          step={1}
          value={field.value}
          disabled={field.unlimited}
          aria-label={ariaLabel}
          onChange={(e) => onChange({ ...field, value: clampBudgetInput(e.target.value, field.value) })}
        />
        <span className="budgets__unlimited">
          <input type="checkbox" checked={field.unlimited} onChange={(e) => onChange({ ...field, unlimited: e.target.checked })} />
          {unlimitedLabel}
        </span>
      </span>
    </label>
  );
}

/** Linha "Gerações simultâneas no modelo local" (spec paralelismo §UI): input 1..8, Salvar próprio e o estado da troca. */
function LocalParallelRow({ status, busy, error, onSave }: {
  readonly status: LocalParallelStatus; readonly busy: boolean; readonly error: string | null; readonly onSave: (n: number) => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(status.wanted);
  useEffect(() => setValue(status.wanted), [status.wanted]);
  const kind = localParallelStateKind(status);
  const stateText = kind === 'pending' ? t('providers.budgets.localParallel.pending')
    : kind === 'external' ? t('providers.budgets.localParallel.external', { n: status.wanted })
      : t('providers.budgets.localParallel.applied');
  return (
    <div className="budgets__row">
      <label className="role__field budgets__row">
        <span>{t('providers.budgets.localParallel.label')}</span>
        <span className="budgets__controls">
          <input
            className="role__input budgets__input"
            type="number"
            min={LOCAL_PARALLEL_MIN}
            max={LOCAL_PARALLEL_MAX}
            step={1}
            value={value}
            aria-label={t('providers.budgets.localParallel.label')}
            onChange={(e) => setValue(clampLocalParallelInput(e.target.value, value))}
          />
          <button type="button" className="btn btn--primary" onClick={() => onSave(value)} disabled={busy}>
            {t('providers.budgets.localParallel.save')}
          </button>
        </span>
      </label>
      {error && <div className="role__error" role="alert">{error}</div>}
      <p className="muted-14">{stateText}</p>
      <p className="budgets__note muted-14">{t('providers.budgets.localParallel.note')}</p>
    </div>
  );
}

/** Cartão "Limites dos agentes" em Provedores (spec limites §UI): limites de passos que valem sem reiniciar. */
export function BudgetsCard({ goal, mission, busy, error, onSave, localParallel, localParallelBusy, localParallelError, onSaveLocalParallel }: BudgetsCardProps) {
  const { t } = useI18n();
  const [goalField, setGoalField] = useState<BudgetField>(() => budgetFieldFrom(goal, DEFAULT_GOAL_VISIBLE));
  const [missionField, setMissionField] = useState<BudgetField>(() => budgetFieldFrom(mission, DEFAULT_MISSION_VISIBLE));

  // Snapshot novo (outra aba salvou, ou o daemon subiu com outro default): a tela segue o valor do banco.
  useEffect(() => setGoalField(budgetFieldFrom(goal, DEFAULT_GOAL_VISIBLE)), [goal]);
  useEffect(() => setMissionField(budgetFieldFrom(mission, DEFAULT_MISSION_VISIBLE)), [mission]);

  const save = () => onSave({ goal: budgetFieldToPatchValue(goalField), mission: budgetFieldToPatchValue(missionField) });

  return (
    <div className="card card--grey card--shadow budgets">
      <div className="budgets__head"><Heading size="h4" variant="black">{t('providers.budgets.title')}</Heading></div>
      <BudgetRow
        label={t('providers.budgets.goal')} field={goalField} onChange={setGoalField}
        ariaLabel={t('providers.budgets.goal')} unlimitedLabel={t('providers.budgets.unlimited')}
      />
      <BudgetRow
        label={t('providers.budgets.mission')} field={missionField} onChange={setMissionField}
        ariaLabel={t('providers.budgets.mission')} unlimitedLabel={t('providers.budgets.unlimited')}
      />
      {error && <div className="role__error" role="alert">{error}</div>}
      <button type="button" className="btn btn--primary" onClick={save} disabled={busy}>{t('providers.budgets.save')}</button>
      <p className="budgets__note muted-14">{t('providers.budgets.note')}</p>
      {localParallel && onSaveLocalParallel && (
        <LocalParallelRow
          status={localParallel} busy={localParallelBusy ?? false} error={localParallelError ?? null}
          onSave={onSaveLocalParallel}
        />
      )}
    </div>
  );
}
