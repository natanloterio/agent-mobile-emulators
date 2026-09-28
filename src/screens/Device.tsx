import { Button } from '../components/Button';
import { Heading } from '../components/Heading';
import { Notice } from '../components/Notice';
import { PhoneMock } from '../components/PhoneMock';
import { Pill } from '../components/Pill';
import { useI18n } from '../i18n/I18nProvider';
import type { InputGesture, MissionView } from '../live/types';
import type { VideoBus } from '../live/videoBus';
import type { MissionAction, MissionInstructThen } from '../state/missionActions';
import { isOpenMission } from '../state/missionView';
import type { LogRow, Stat, TileVM } from '../state/selectors';
import './Device.css';
import { MissionPanel } from './MissionPanel';

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
  /** Missão aberta ou concluída mais recente da identidade (spec missões §Interface); demo mostra `demoMission(i18n)`. */
  readonly mission?: MissionView | null;
  readonly missionBusy?: boolean;
  readonly missionError?: string | null;
  readonly now?: number;
  readonly onMission?: (a: MissionAction) => void;
  readonly onInstruct?: (text: string, then?: MissionInstructThen) => Promise<boolean>;
}

/**
 * Checkpoint da plataforma: a ordem certa é assumir, resolver no celular e devolver. Fora do controle o botão principal
 * é assumir ("Resolvi" fica como secundário, para quando já foi resolvido por outro caminho); no controle, um botão só
 * marca resolvido e devolve ao agente.
 */
function NeedsCard({ error, busy, control, onTakeControl, onResolve, onResolveAndRelease, onBan }: {
  readonly error: string; readonly busy: boolean; readonly control: boolean;
  readonly onTakeControl: () => void; readonly onResolve: () => void; readonly onResolveAndRelease: () => void; readonly onBan?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="card card--dark needs">
      <span className="needs__kicker">{t('device.needs.kicker')}</span>
      <span className="needs__error">{error}</span>
      <span className="needs__body">{t('device.needs.body')}</span>
      <span className="needs__body" role="status">{t(control ? 'device.needs.inControl' : 'device.needs.how')}</span>
      <div className="device__controls">
        {control ? (
          <Button variant="tertiary" disabled={busy} onClick={onResolveAndRelease}>{t('device.needs.resolveRelease')}</Button>
        ) : (
          <>
            <Button variant="tertiary" disabled={busy} onClick={onTakeControl}>{t('device.needs.take')}</Button>
            <Button variant="secondary" disabled={busy} onClick={onResolve}>{t('device.needs.resolve')}</Button>
          </>
        )}
        {onBan && <Button variant="secondary" disabled={busy} onClick={onBan}>{t('device.needs.ban')}</Button>}
      </div>
    </div>
  );
}

function StepLog({ log, isMobile }: { readonly log: readonly LogRow[]; readonly isMobile: boolean }) {
  const { t } = useI18n();
  return (
    <div className="card card--white log">
      <div className="row-between log__head">
        <Heading size="h4">{t('device.log.title')}</Heading>
        <span className="muted-14">{t('device.log.pruned')}</span>
      </div>
      {log.length === 0 && <span className="log__empty">{t('device.log.empty')}</span>}
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
          <span className={`log__tag${l.tag === 'gate' ? ' log__tag--gate' : ''}`}>{l.tag === 'agora' ? t('device.log.now') : l.tag}</span>
        </div>
      ))}
    </div>
  );
}

export function Device(p: DeviceProps) {
  const { sel, control, paused, busy, isMobile } = p;
  const { t } = useI18n();
  return (
    <div className="screen">
      <header className="screen__header" style={{ alignItems: 'center' }}>
        <div className="screen__title" style={{ gap: 20 }}>
          <button type="button" className="device__back" onClick={p.onBack}>← {t('shell.nav.cockpit')}</button>
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
              {t(control ? 'device.control.release' : 'device.control.take')}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={p.onTogglePause}>
              {t(paused ? 'device.resume' : 'device.pause')}
            </Button>
          </div>
          {p.errors.map((e) => <Notice key={e}>{e}</Notice>)}
        </div>

        <div className="device__right">
          {sel.needs && !(p.mission && isOpenMission(p.mission)) && <NeedsCard
              error={sel.error} busy={busy} control={control} onTakeControl={p.onToggleControl} onResolve={p.onResolve} onBan={p.onBan}
              onResolveAndRelease={() => { p.onResolve(); p.onToggleControl(); }}
            />}
          {p.mission && (
            <MissionPanel
              mission={p.mission} busy={!!p.missionBusy} error={p.missionError ?? null} now={p.now ?? Date.now()}
              onAction={(a) => p.onMission?.(a)} onInstruct={(text, then) => p.onInstruct?.(text, then) ?? Promise.resolve(false)}
            />
          )}

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
