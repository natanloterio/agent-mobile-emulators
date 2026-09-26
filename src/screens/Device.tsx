import { Button } from '../components/Button';
import { Heading } from '../components/Heading';
import { Notice } from '../components/Notice';
import { PhoneMock } from '../components/PhoneMock';
import { Pill } from '../components/Pill';
import type { InputGesture } from '../live/types';
import type { VideoBus } from '../live/videoBus';
import type { LogRow, Stat, TileVM } from '../state/selectors';
import './Device.css';

interface DeviceProps {
  readonly sel: TileVM;
  readonly log: readonly LogRow[];
  readonly stats: readonly Stat[];
  /** No vivo vem de `controlled`/`paused` do snapshot; no demo, do estado local. */
  readonly control: boolean;
  readonly paused: boolean;
  readonly streamLabel: string;
  readonly isMobile: boolean;
  /** Requisição da identidade em andamento: botões travados até a resposta. */
  readonly busy: boolean;
  readonly errors: readonly string[];
  readonly onBack: () => void;
  readonly onToggleControl: () => void;
  readonly onTogglePause: () => void;
  readonly onResolve: () => void;
  /** Só no vivo: "Marcar como banida" (POST /ban). */
  readonly onBan?: () => void;
  /** Só no vivo e com controle: gesto na tela → POST /input. */
  readonly onInput?: (g: InputGesture) => void;
  readonly bus?: VideoBus | null;
}

function NeedsCard({ error, busy, onResolve, onBan }: { readonly error: string; readonly busy: boolean; readonly onResolve: () => void; readonly onBan?: () => void }) {
  return (
    <div className="card card--dark needs">
      <span className="needs__kicker">Precisa de atenção humana</span>
      <span className="needs__error">{error}</span>
      <span className="needs__body">
        Identidade parada, sem retry automático. Retry em bloqueio de plataforma transforma bloqueio leve em banimento.
      </span>
      <div className="device__controls">
        <Button variant="tertiary" disabled={busy} onClick={onResolve}>Resolvi, devolver à fila</Button>
        {onBan && <Button variant="secondary" disabled={busy} onClick={onBan}>Marcar como banida</Button>}
      </div>
    </div>
  );
}

function StepLog({ log, isMobile }: { readonly log: readonly LogRow[]; readonly isMobile: boolean }) {
  return (
    <div className="card card--white log">
      <div className="row-between log__head">
        <Heading size="h4">Passos recentes</Heading>
        <span className="muted-14">histórico podado: modelo vê só os 2 últimos estados</span>
      </div>
      {log.length === 0 && <span className="log__empty">Nenhum passo ainda.</span>}
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
  );
}

export function Device(p: DeviceProps) {
  const { sel, control, paused, busy, isMobile } = p;
  return (
    <div className="screen">
      <header className="screen__header" style={{ alignItems: 'center' }}>
        <div className="screen__title" style={{ gap: 20 }}>
          <button type="button" className="device__back" onClick={p.onBack}>← Cockpit</button>
          <Heading size={isMobile ? 'h3' : 'h2'}>{sel.name}</Heading>
          <span className="device__sub">{sel.handle} · {sel.app} {sel.version}</span>
        </div>
        <Pill tone={sel.pillTone} greenBorder={sel.pillGreenBorder} size="md">{sel.stateLabel}</Pill>
      </header>

      <div className="device__grid">
        <div className="device__left">
          <PhoneMock
            variant="full" handle={sel.handle} streamLabel={p.streamLabel} draft={sel.replyDraft} controlled={control}
            videoId={sel.id} bus={p.bus} screen={sel.screen} video={sel.video} onInput={control ? p.onInput : undefined}
          />
          <div className="device__controls">
            <Button variant={control ? 'tertiary' : 'primary'} grow disabled={busy} onClick={p.onToggleControl}>
              {control ? 'Devolver ao agente' : 'Assumir controle'}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={p.onTogglePause}>
              {paused ? 'Retomar' : 'Pausar identidade'}
            </Button>
          </div>
          {p.errors.map((e) => <Notice key={e}>{e}</Notice>)}
        </div>

        <div className="device__right">
          {sel.needs && <NeedsCard error={sel.error} busy={busy} onResolve={p.onResolve} onBan={p.onBan} />}

          <div className="stats">
            {p.stats.map((s) => (
              <div className="stat" key={s.label}>
                <span className="stat__value">{s.value}</span>
                <span className="stat__label">{s.label}</span>
              </div>
            ))}
          </div>

          <StepLog log={p.log} isMobile={isMobile} />
        </div>
      </div>
    </div>
  );
}
