import { useState } from 'react';
import { Button } from '../components/Button';
import { Heading } from '../components/Heading';
import { Notice } from '../components/Notice';
import { useI18n } from '../i18n/I18nProvider';
import type { MissionView } from '../live/types';
import type { MissionInstructThen } from '../state/missionActions';
import { missionInstructThen } from '../state/missionView';
import './Mission.css';

interface MissionInstructProps {
  readonly mission: MissionView; readonly busy: boolean; readonly error: string | null;
  readonly onInstruct: (text: string, then?: MissionInstructThen) => Promise<boolean>;
  /** "Resolvi, continuar" (existente): some do bloco de ações e entra aqui, ao lado de "Enviar e continuar". */
  readonly onResolved: () => void;
}

/** Bloco "Instrução para o agente" (spec instruções §Interface): texto livre + histórico com o selo de leitura. */
export function MissionInstruct({ mission: m, busy, error, onInstruct, onResolved }: MissionInstructProps) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  if (m.state === 'done' || m.state === 'abandoned') return null;

  const then = missionInstructThen(m.state);
  const hint = m.state === 'running' ? t('mission.instruct.hint.running') : t('mission.instruct.hint.waiting');
  const sendLabel = then === 'continue' ? t('mission.instruct.sendContinue') : then === 'resume' ? t('mission.instruct.sendResume') : t('mission.instruct.send');
  const send = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    // Só limpa quando o daemon aceitou: em erro o texto fica para reenviar.
    void onInstruct(trimmed, then).then((ok) => { if (ok) setText(''); });
  };

  return (
    <div className="instr">
      <div className="instr__head">
        <Heading size="h4">{t('mission.instruct.title')}</Heading>
        <span className="instr__hint">{hint}</span>
      </div>
      <div className="instr__form">
        <textarea
          className="instr__input" rows={2} maxLength={1000} value={text}
          placeholder={t('mission.instruct.placeholder')} onChange={(e) => setText(e.target.value)}
        />
        <Button variant={then ? 'tertiary' : 'primary'} disabled={busy || !text.trim()} onClick={send}>{sendLabel}</Button>
        {m.state === 'awaiting-human' && <Button variant="secondary" disabled={busy} onClick={onResolved}>{t('mission.action.continue')}</Button>}
      </div>
      {error && <Notice>{error}</Notice>}
      {m.notes.length > 0 && (
        <ul className="instr__list">
          {m.notes.map((n) => (
            <li className="instr__item" key={n.id}>
              <span className="instr__who">{t('mission.instruct.you')}</span>
              <span>{n.text}</span>
              <span className={`instr__state${n.readSeq === null ? ' instr__state--pending' : ''}`}>
                {n.readSeq === null ? t('mission.instruct.pending') : t('mission.instruct.read', { n: n.readSeq })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
