import { useState } from 'react';
import { Button } from '../components/Button';
import { Notice } from '../components/Notice';
import { useI18n } from '../i18n/I18nProvider';
import type { RequestStatus } from '../state/fleetReducer';
import './Mission.css';

export interface MissionIdentityOption { readonly id: string; readonly name: string; readonly handle: string; readonly disabled: boolean; readonly note: string }

/** Missão: texto livre + uma identidade (spec missões §Interface). */
export function MissionComposer({ options, req, onStart }: { readonly options: readonly MissionIdentityOption[]; readonly req: RequestStatus; readonly onStart: (identityId: string, text: string) => void }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const firstFree = options.find((o) => !o.disabled)?.id ?? '';
  const [picked, setPicked] = useState(firstFree);
  const chosen = options.some((o) => o.id === picked && !o.disabled) ? picked : firstFree;
  return (
    <div className="card card--grey card--shadow newgoal__composer">
      <p className="screen__lede">{t('mission.lede')}</p>
      <textarea className="newgoal__textarea" autoFocus rows={3} value={text} placeholder={t('mission.placeholder')} onChange={(e) => setText(e.target.value)} />
      <div className="mission__compose-ids" role="radiogroup" aria-label={t('mission.pickIdentity')}>
        {options.length === 0 && <span className="muted-14">{t('mission.noIdentities')}</span>}
        {options.map((o) => (
          <label key={o.id} className="mission__id" aria-disabled={o.disabled}>
            <input type="radio" name="mission-identity" value={o.id} disabled={o.disabled} checked={chosen === o.id} onChange={() => setPicked(o.id)} />
            <span>{o.name} <span className="muted-14">{o.handle}</span></span>
            <span className="muted-14">{o.note}</span>
          </label>
        ))}
      </div>
      <div className="row-between" style={{ justifyContent: 'flex-end' }}>
        <Button size="lg" disabled={req.busy || !chosen} onClick={() => onStart(chosen, text)}>{req.busy ? t('mission.starting') : t('mission.start')}</Button>
      </div>
      {req.error && <Notice>{t('mission.startFailed', { error: req.error })}</Notice>}
    </div>
  );
}
