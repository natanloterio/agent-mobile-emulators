import { useMemo, useState } from 'react';
import { Button } from '../components/Button';
import { Heading } from '../components/Heading';
import { Notice } from '../components/Notice';
import { DEFAULT_GOAL_TEXT, defaultGoalText, goalExamples } from '../data/goals';
import { useI18n } from '../i18n/I18nProvider';
import { useDaemonError } from '../i18n/useDaemonError';
import type { RequestStatus } from '../state/fleetReducer';
import { localizePlanVM, type PlanTaskVM, type PlanVM } from '../state/planView';
import type { PlanStage } from '../types/fleet';
import { MissionComposer, type MissionIdentityOption } from './MissionComposer';
import './NewGoal.css';

interface NewGoalProps {
  readonly goalText: string;
  readonly planStage: PlanStage;
  /** Plano a exibir (estágio 2): o do líder no vivo, o do design no demo. */
  readonly plan: PlanVM | null;
  readonly planReq: RequestStatus;
  readonly launchReq: RequestStatus;
  readonly isMobile: boolean;
  readonly onSetGoal: (text: string) => void;
  readonly onDecompose: () => void;
  readonly onReset: () => void;
  readonly onLaunch: () => void;
  /** Só no vivo: alterna Objetivo | Missão (spec missões §Interface). */
  readonly mission?: { readonly options: readonly MissionIdentityOption[]; readonly req: RequestStatus; readonly onStart: (identityIds: readonly string[], text: string) => void };
}

/** Objetivo (líder + fan-out) oculto por enquanto: no vivo a tela só oferece Missão. O código do Objetivo fica para voltar. */
const GOAL_MODE_VISIBLE = false;

function TaskRow({ t }: { readonly t: PlanTaskVM }) {
  return (
    <div className="plan__task">
      <span className="plan__task-name">{t.name} <span className="plan__task-handle">{t.handle}</span></span>
      <span>{t.instr}</span>
      <div className="plan__signals">
        {t.signals.map((ok, k) => <span key={k} className={`plan__dot${ok ? ' plan__dot--ok' : ''}`} />)}
        <span className="plan__ready">{t.readyLabel}</span>
      </div>
    </div>
  );
}

function PlanView({ plan, launchReq, onReset, onLaunch }: { readonly plan: PlanVM; readonly launchReq: RequestStatus; readonly onReset: () => void; readonly onLaunch: () => void }) {
  const { t } = useI18n();
  const te = useDaemonError();
  return (
    <div className="plan">
      {plan.leaderWarning && <Notice tone="warn">{plan.leaderWarning}</Notice>}
      <div className="plan__cards">
        <div className="card card--green card--shadow plan__card">
          <span className="plan__kicker">{t('goal.plan.patternKicker')}</span>
          <span className="plan__pattern">{plan.patternLabel}</span>
          <span className="plan__body">{plan.rationale}</span>
        </div>
        <div className="card card--dark card--shadow plan__card plan__card--dark" style={{ gap: 12 }}>
          <span className="plan__kicker">{t('goal.plan.estimateKicker')}</span>
          {plan.estimate.map((e) => (
            <div className="plan__est" key={e.label}><span>{e.label}</span><span>{e.value}</span></div>
          ))}
        </div>
      </div>

      <div className="card card--white">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <Heading size="h4">{t('goal.plan.tasksTitle')}</Heading>
          <span className="muted-14">boot · accessibility · initialize · tools · versionName</span>
        </div>
        {plan.tasks.map((t) => <TaskRow key={t.key} t={t} />)}
        {plan.tasks.length === 0 && <span className="muted-14">{t('goal.plan.noTasks')}</span>}
      </div>

      {launchReq.error && <Notice>{t('goal.plan.launchFailed', { error: te(launchReq.error) })}</Notice>}
      <div className="plan__actions">
        <Button variant="secondary" size="lg" onClick={onReset}>{t('goal.plan.edit')}</Button>
        <Button variant="tertiary" size="lg" disabled={launchReq.busy} onClick={onLaunch}>
          {launchReq.busy ? t('goal.plan.launching') : t('goal.plan.launch')}
        </Button>
      </div>
    </div>
  );
}

export function NewGoal({ goalText, planStage, plan, planReq, launchReq, isMobile, onSetGoal, onDecompose, onReset, onLaunch, mission }: NewGoalProps) {
  const i18n = useI18n();
  const te = useDaemonError();
  const { t } = i18n;
  const [mode, setMode] = useState<'goal' | 'mission'>(GOAL_MODE_VISIBLE ? 'goal' : 'mission');
  const missionOnly = !!mission && !GOAL_MODE_VISIBLE;
  const decomposing = planStage === 1 || planReq.busy;
  const shownPlan = useMemo(() => (plan ? localizePlanVM(plan, i18n) : null), [plan, i18n]);
  // O objetivo padrão chega em português quando o composer estava vazio: mostra no idioma da tela.
  const shownText = goalText === DEFAULT_GOAL_TEXT ? defaultGoalText(i18n) : goalText;
  return (
    <div className="screen newgoal">
      <header className="screen__title">
        <Heading size={isMobile ? 'h3' : 'h2'}>{missionOnly ? t('mission.title') : t('goal.title')}</Heading>
        {!missionOnly && <p className="screen__lede">{t('goal.lede')}</p>}
      </header>

      {mission && !missionOnly && (
        <div className="newgoal__modes" role="tablist">
          <Button variant={mode === 'goal' ? 'primary' : 'ghost'} size="sm" onClick={() => setMode('goal')}>{t('mission.mode.goal')}</Button>
          <Button variant={mode === 'mission' ? 'primary' : 'ghost'} size="sm" onClick={() => setMode('mission')}>{t('mission.mode.mission')}</Button>
        </div>
      )}
      {mission && mode === 'mission' ? <MissionComposer {...mission} /> : (
        <>
          <div className="card card--grey card--shadow newgoal__composer">
            <textarea
              className="newgoal__textarea"
              autoFocus
              value={shownText}
              onChange={(e) => onSetGoal(e.target.value)}
              rows={3}
              placeholder={t('goal.placeholder')}
            />
            <div className="row-between" style={{ gap: 16 }}>
              <div className="newgoal__examples">
                {goalExamples(i18n).map((ex) => (
                  <Button key={ex.label} variant="ghost" size="sm" onClick={() => onSetGoal(ex.text)}>{ex.label}</Button>
                ))}
              </div>
              <Button size="lg" disabled={decomposing} onClick={onDecompose}>{decomposing ? t('goal.decomposing') : t('goal.decompose')}</Button>
            </div>
            {planReq.error && <Notice>{t('goal.decomposeFailed', { error: te(planReq.error) })}</Notice>}
          </div>

          {planStage === 2 && shownPlan && <PlanView plan={shownPlan} launchReq={launchReq} onReset={onReset} onLaunch={onLaunch} />}
        </>
      )}
    </div>
  );
}
