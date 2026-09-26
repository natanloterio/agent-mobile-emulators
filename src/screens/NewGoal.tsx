import { Button } from '../components/Button';
import { Heading } from '../components/Heading';
import { GOAL_EXAMPLES } from '../data/goals';
import type { PlanTask, Stat } from '../state/selectors';
import type { PlanStage } from '../types/fleet';
import './NewGoal.css';

interface NewGoalProps {
  readonly goalText: string;
  readonly planStage: PlanStage;
  readonly planTasks: readonly PlanTask[];
  readonly estimate: readonly Stat[];
  readonly isMobile: boolean;
  readonly onSetGoal: (text: string) => void;
  readonly onDecompose: () => void;
  readonly onReset: () => void;
  readonly onLaunch: () => void;
}

export function NewGoal({ goalText, planStage, planTasks, estimate, isMobile, onSetGoal, onDecompose, onReset, onLaunch }: NewGoalProps) {
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
          <Button size="lg" onClick={onDecompose}>{planStage === 1 ? 'Líder decompondo…' : 'Decompor'}</Button>
        </div>
      </div>

      {planStage === 2 && (
        <div className="plan">
          <div className="plan__cards">
            <div className="card card--green card--shadow plan__card">
              <span className="plan__kicker">Padrão escolhido pelo líder</span>
              <span className="plan__pattern">Fan-out replicado</span>
              <span className="plan__body">O trabalho pertence à conta: cada identidade responde a própria caixa. Uma tarefa por identidade.</span>
            </div>
            <div className="card card--dark card--shadow plan__card plan__card--dark" style={{ gap: 12 }}>
              <span className="plan__kicker">Estimativa</span>
              {estimate.map((e) => (
                <div className="plan__est" key={e.label}><span>{e.label}</span><span>{e.value}</span></div>
              ))}
            </div>
          </div>

          <div className="card card--white">
            <div className="row-between" style={{ marginBottom: 12 }}>
              <Heading size="h4">Tarefas e sonda de prontidão</Heading>
              <span className="muted-14">boot · accessibility · initialize · tools · versionName</span>
            </div>
            {planTasks.map((p) => (
              <div className="plan__task" key={p.name}>
                <span className="plan__task-name">{p.name} <span className="plan__task-handle">{p.handle}</span></span>
                <span>{p.instr}</span>
                <div className="plan__signals">
                  {Array.from({ length: 5 }, (_, k) => (
                    <span key={k} className={`plan__dot${k < p.signalsOk ? ' plan__dot--ok' : ''}`} />
                  ))}
                  <span className="plan__ready">{p.readyLabel}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="plan__actions">
            <Button variant="secondary" size="lg" onClick={onReset}>Editar objetivo</Button>
            <Button variant="tertiary" size="lg" onClick={onLaunch}>Iniciar e sair de perto</Button>
          </div>
        </div>
      )}
    </div>
  );
}
