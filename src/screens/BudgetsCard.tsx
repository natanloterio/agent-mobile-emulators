import { useEffect, useState } from 'react';
import { Heading } from '../components/Heading';
import { useI18n } from '../i18n/I18nProvider';
import {
  BUDGET_MAX, BUDGET_MIN, budgetFieldFrom, budgetFieldToPatchValue, clampBudgetInput, type BudgetField,
} from './budgetsField';

export interface BudgetsCardProps {
  /** Valor atual no daemon (spec limites §UI); `null` = sem limite. */
  readonly goal: number | null;
  readonly mission: number | null;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onSave: (patch: { goal?: number | null; mission?: number | null }) => void;
}

const DEFAULT_VISIBLE = 30; // número mostrado no campo quando o valor atual é "sem limite" (nada mais sensato para editar a partir daí)

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

/** Cartão "Limites dos agentes" em Provedores (spec limites §UI): limites de passos que valem sem reiniciar. */
export function BudgetsCard({ goal, mission, busy, error, onSave }: BudgetsCardProps) {
  const { t } = useI18n();
  const [goalField, setGoalField] = useState<BudgetField>(() => budgetFieldFrom(goal, DEFAULT_VISIBLE));
  const [missionField, setMissionField] = useState<BudgetField>(() => budgetFieldFrom(mission, DEFAULT_VISIBLE));

  // Snapshot novo (outra aba salvou, ou o daemon subiu com outro default): a tela segue o valor do banco.
  useEffect(() => setGoalField(budgetFieldFrom(goal, DEFAULT_VISIBLE)), [goal]);
  useEffect(() => setMissionField(budgetFieldFrom(mission, DEFAULT_VISIBLE)), [mission]);

  const save = () => onSave({ goal: budgetFieldToPatchValue(goalField), mission: budgetFieldToPatchValue(missionField) });

  return (
    <div className="card card--grey card--shadow budgets">
      <Heading size="h4" variant="black">{t('providers.budgets.title')}</Heading>
      <BudgetRow
        label={t('providers.budgets.goal')} field={goalField} onChange={setGoalField}
        ariaLabel={t('providers.budgets.aria.goal')} unlimitedLabel={t('providers.budgets.unlimited')}
      />
      <BudgetRow
        label={t('providers.budgets.mission')} field={missionField} onChange={setMissionField}
        ariaLabel={t('providers.budgets.aria.mission')} unlimitedLabel={t('providers.budgets.unlimited')}
      />
      {error && <div className="role__error" role="alert">{error}</div>}
      <button type="button" className="btn btn--primary" onClick={save} disabled={busy}>{t('providers.budgets.save')}</button>
      <p className="budgets__note muted-14">{t('providers.budgets.note')}</p>
    </div>
  );
}
