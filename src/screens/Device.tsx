import { Button } from '../components/Button';
import { Heading } from '../components/Heading';
import { PhoneMock } from '../components/PhoneMock';
import { Pill } from '../components/Pill';
import type { LogRow, Stat, TileVM } from '../state/selectors';
import './Device.css';

interface DeviceProps {
  readonly sel: TileVM;
  readonly log: readonly LogRow[];
  readonly stats: readonly Stat[];
  readonly control: boolean;
  readonly isMobile: boolean;
  readonly onBack: () => void;
  readonly onToggleControl: () => void;
  readonly onTogglePause: () => void;
  readonly onResolve: () => void;
}

export function Device({ sel, log, stats, control, isMobile, onBack, onToggleControl, onTogglePause, onResolve }: DeviceProps) {
  const streamLabel = control ? '1080p · 60 fps · input ligado' : '1080p · 30 fps · input desligado';
  return (
    <div className="screen">
      <header className="screen__header" style={{ alignItems: 'center' }}>
        <div className="screen__title" style={{ gap: 20 }}>
          <button type="button" className="device__back" onClick={onBack}>← Cockpit</button>
          <Heading size={isMobile ? 'h3' : 'h2'}>{sel.name}</Heading>
          <span className="device__sub">{sel.handle} · {sel.app} {sel.version}</span>
        </div>
        <Pill tone={sel.pillTone} greenBorder={sel.pillGreenBorder} size="md">{sel.stateLabel}</Pill>
      </header>

      <div className="device__grid">
        <div className="device__left">
          <PhoneMock variant="full" handle={sel.handle} streamLabel={streamLabel} draft={sel.replyDraft} controlled={control} />
          <div className="device__controls">
            <Button variant={control ? 'tertiary' : 'primary'} grow onClick={onToggleControl}>
              {control ? 'Devolver ao agente' : 'Assumir controle'}
            </Button>
            <Button variant="secondary" onClick={onTogglePause}>
              {sel.state === 'idle' ? 'Retomar' : 'Pausar identidade'}
            </Button>
          </div>
        </div>

        <div className="device__right">
          {sel.needs && (
            <div className="card card--dark needs">
              <span className="needs__kicker">Precisa de atenção humana</span>
              <span className="needs__error">{sel.error}</span>
              <span className="needs__body">
                Identidade parada, sem retry automático. Retry em bloqueio de plataforma transforma bloqueio leve em banimento.
              </span>
              <div className="device__controls">
                <Button variant="tertiary" onClick={onResolve}>Resolvi, devolver à fila</Button>
              </div>
            </div>
          )}

          <div className="stats">
            {stats.map((s) => (
              <div className="stat" key={s.label}>
                <span className="stat__value">{s.value}</span>
                <span className="stat__label">{s.label}</span>
              </div>
            ))}
          </div>

          <div className="card card--white log">
            <div className="row-between log__head">
              <Heading size="h4">Passos recentes</Heading>
              <span className="muted-14">histórico podado: modelo vê só os 2 últimos estados</span>
            </div>
            {log.map((l, k) => (
              <div className="log__row" key={k}>
                <span>#{l.i}</span>
                {isMobile ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                    <span className="log__desc">{l.desc}</span>
                    <span className="log__tool">{l.tool} · {l.tokens}</span>
                  </div>
                ) : (
                  <>
                    <span className="log__tool">{l.tool}</span>
                    <span className="log__desc">{l.desc}</span>
                    <span>{l.tokens}</span>
                  </>
                )}
                <span className={`log__tag${l.tag === 'gate' ? ' log__tag--gate' : ''}`}>{l.tag}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
