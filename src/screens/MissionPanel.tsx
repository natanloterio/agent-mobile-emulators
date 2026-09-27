import { Button } from '../components/Button';
import { Heading } from '../components/Heading';
import { Notice } from '../components/Notice';
import { Pill } from '../components/Pill';
import { useI18n } from '../i18n/I18nProvider';
import type { MissionView } from '../live/types';
import type { MissionAction, MissionInstructThen } from '../state/missionActions';
import { isOpenMission, missionElapsed, missionTimeline } from '../state/missionView';
import { MissionInstruct } from './MissionInstruct';
import './Mission.css';

interface MissionPanelProps {
  readonly mission: MissionView; readonly busy: boolean; readonly error: string | null; readonly now: number;
  readonly onAction: (a: MissionAction) => void;
  readonly onInstruct: (text: string, then?: MissionInstructThen) => void;
}

/** Painel da missão no Device (spec missões §Interface): estado, humano, linha do tempo, memória e ações. */
export function MissionPanel({ mission: m, busy, error, now, onAction, onInstruct }: MissionPanelProps) {
  const i18n = useI18n(); const { t, fmt } = i18n;
  const open = isOpenMission(m);
  return (
    <div className="card card--white mission">
      <div className="mission__head">
        <Heading size="h4">{t('mission.panel.title')}</Heading>
        <Pill tone={m.state === 'awaiting-human' ? 'dark' : m.state === 'running' ? 'green' : 'grey'} size="md">{t(`mission.state.${m.state}`)}</Pill>
      </div>
      <span className="mission__text">{m.text}</span>

      {m.state === 'awaiting-human' && (
        <div className="card card--dark needs">
          <span className="needs__kicker">{t('mission.human.kicker')}</span>
          <span className="needs__error">{m.humanReason}</span>
          <span className="needs__body">{t('mission.human.body')}</span>
        </div>
      )}
      {m.state === 'paused' && m.humanReason && <Notice tone="warn">{t('mission.reason', { reason: m.humanReason })}</Notice>}
      {m.stalled && open && <Notice tone="warn">{t('mission.stalled')}</Notice>}

      <div className="mission__stats">
        <span><b>{fmt.usd(m.costUsd)}</b> {t('mission.stats.cost')}</span>
        <span><b>{missionElapsed(m, now, i18n)}</b> {t('mission.stats.elapsed')}</span>
        <span><b>{m.subtasks.length}</b> {t('mission.stats.subtasks')}</span>
      </div>

      {open && (
        <div className="mission__actions">
          {m.state === 'running' && <Button variant="secondary" disabled={busy} onClick={() => onAction('pause')}>{t('mission.action.pause')}</Button>}
          {m.state === 'paused' && <Button variant="primary" disabled={busy} onClick={() => onAction('resume')}>{t('mission.action.resume')}</Button>}
          <Button variant="ghost" disabled={busy} onClick={() => onAction('abandon')}>{t('mission.action.abandon')}</Button>
        </div>
      )}

      {open && (
        <MissionInstruct mission={m} busy={busy} error={error} onInstruct={onInstruct} onResolved={() => onAction('continue')} />
      )}

      <div>
        <Heading size="h4">{t('mission.timeline.title')}</Heading>
        {m.subtasks.length === 0 && <span className="muted-14">{t('mission.timeline.empty')}</span>}
        {missionTimeline(m).map((r) => (
          <div className="mission__row" key={r.seq}>
            <span className="mission__mark">{r.mark}</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <span className="mission__obj">#{r.seq} {r.objective}</span>
              {r.did && <span className="mission__detail">{t('mission.timeline.did', { did: r.did })}</span>}
              {r.blockers && <span className="mission__detail">{t('mission.timeline.blockers', { blockers: r.blockers })}</span>}
            </div>
          </div>
        ))}
      </div>

      <div>
        <Heading size="h4">{t('mission.memory.title')}</Heading>
        {m.memory.length === 0 ? <span className="muted-14">{t('mission.memory.empty')}</span> : (
          <div className="mission__mem">
            {m.memory.map((x) => [<span key={`${x.key}:k`} className="muted-14">{x.key}</span>, <span key={`${x.key}:v`}>{x.secret ? '•••' : x.value}</span>])}
          </div>
        )}
      </div>
    </div>
  );
}
