import { Button } from '../components/Button';
import { Heading } from '../components/Heading';
import { Notice } from '../components/Notice';
import { GOAL_EXAMPLES } from '../data/goals';
import type { RequestStatus } from '../state/fleetReducer';
import type { PlanTaskVM, PlanVM } from '../state/planView';
import type { PlanStage } from '../types/fleet';
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
}

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
  return (
    <div className="plan">
      {plan.leaderWarning && <Notice tone="warn">{plan.leaderWarning}</Notice>}
      <div className="plan__cards">
        <div className="card card--green card--shadow plan__card">
          <span className="plan__kicker">Padrão escolhido pelo líder</span>
          <span className="plan__pattern">{plan.patternLabel}</span>
          <span className="plan__body">{plan.rationale}</span>
        </div>
        <div className="card card--dark card--shadow plan__card plan__card--dark" style={{ gap: 12 }}>
          <span className="plan__kicker">Estimativa</span>
          {plan.estimate.map((e) => (
            <div className="plan__est" key={e.label}><span>{e.label}</span><span>{e.value}</span></div>
          ))}
        </div>
      </div>

      <div className="card card--white">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <Heading size="h4">Tarefas e sonda de prontidão</Heading>
          <span className="muted-14">boot · accessibility · initialize · tools · versionName</span>
        </div>
        {plan.tasks.map((t) => <TaskRow key={t.key} t={t} />)}
        {plan.tasks.length === 0 && <span className="muted-14">Nenhuma identidade no plano.</span>}
      </div>

      {launchReq.error && <Notice>Não iniciou: {launchReq.error}</Notice>}
      <div className="plan__actions">
        <Button variant="secondary" size="lg" onClick={onReset}>Editar objetivo</Button>
        <Button variant="tertiary" size="lg" disabled={launchReq.busy} onClick={onLaunch}>
          {launchReq.busy ? 'Iniciando…' : 'Iniciar e sair de perto'}
        </Button>
      </div>
    </div>
  );
}

export function NewGoal({ goalText, planStage, plan, planReq, launchReq, isMobile, onSetGoal, onDecompose, onReset, onLaunch }: NewGoalProps) {
  const decomposing = planStage === 1 || planReq.busy;
  return (
    <div className="screen newgoal">
      <header className="screen__title">
        <Heading size={isMobile ? 'h3' : 'h2'}>Novo objetivo</Heading>
        <p className="screen__lede">Descreva o que quer em linguagem natural. O líder decompõe, distribui e executa sem supervisão.</p>
      </header>

      <div className="card card--grey card--shadow newgoal__composer">
        <textarea
          className="newgoal__textarea"
          value={goalText}
          onChange={(e) => onSetGoal(e.target.value)}
          rows={3}
          placeholder="Ex.: Responder os comentários das últimas 24 h em todas as contas das lojas"
        />
        <div className="row-between" style={{ gap: 16 }}>
          <div className="newgoal__examples">
            {GOAL_EXAMPLES.map((label) => (
              <Button key={label} variant="ghost" size="sm" onClick={() => onSetGoal(`${label} em todas as contas`)}>{label}</Button>
            ))}
          </div>
          <Button size="lg" disabled={decomposing} onClick={onDecompose}>{decomposing ? 'Líder decompondo…' : 'Decompor'}</Button>
        </div>
        {planReq.error && <Notice>Decomposição falhou: {planReq.error}</Notice>}
      </div>

      {planStage === 2 && plan && <PlanView plan={plan} launchReq={launchReq} onReset={onReset} onLaunch={onLaunch} />}
    </div>
  );
}
