import { useState } from 'react';
import { Button } from '../components/Button';
import { Notice } from '../components/Notice';
import { useI18n } from '../i18n/I18nProvider';
import { useDaemonError } from '../i18n/useDaemonError';
import type { RequestStatus } from '../state/fleetReducer';
import { ChainComposer } from './ChainComposer';
import type { ChainStepDraft } from './chainSteps';
import { pickedFree, toggleAll, togglePick, type MissionIdentityOption } from './missionPick';
import './Mission.css';

export type { MissionIdentityOption };

export interface MissionComposerProps {
  readonly options: readonly MissionIdentityOption[]; readonly req: RequestStatus;
  readonly onStart: (identityIds: readonly string[], text: string) => void;
  /** Sequência com arquivo (spec arquivos); ausente, só o modo "várias contas em paralelo". */
  readonly onStartChain?: (steps: readonly ChainStepDraft[]) => void;
}

/**
 * Missão: texto livre + uma, várias ou todas as identidades, cada uma roda a sua missão (spec missões §Interface);
 * ou uma sequência de etapas em contas diferentes, com o arquivo de uma indo para a seguinte (spec arquivos).
 */
export function MissionComposer({ options, req, onStart, onStartChain }: MissionComposerProps) {
  const { t } = useI18n();
  const te = useDaemonError();
  const [kind, setKind] = useState<'parallel' | 'chain'>('parallel');
  const [text, setText] = useState('');
  const firstFree = options.find((o) => !o.disabled)?.id;
  // Sem escolha do operador ainda (as opções chegam com o snapshot): vale a primeira identidade livre.
  const [touched, setTouched] = useState<ReadonlySet<string> | null>(null);
  const picked = touched ?? new Set(firstFree ? [firstFree] : []);
  const chosen = pickedFree(options, picked);
  const free = options.filter((o) => !o.disabled);
  const allOn = free.length > 0 && chosen.length === free.length;
  const flip = (id: string) => setTouched(togglePick(picked, id));
  return (
    <div className="card card--grey card--shadow newgoal__composer">
      {onStartChain && (
        <div className="newgoal__modes" role="tablist">
          <Button variant={kind === 'parallel' ? 'primary' : 'ghost'} size="sm" onClick={() => setKind('parallel')}>{t('files.chain.mode.parallel')}</Button>
          <Button variant={kind === 'chain' ? 'primary' : 'ghost'} size="sm" onClick={() => setKind('chain')}>{t('files.chain.mode.chain')}</Button>
        </div>
      )}
      {onStartChain && kind === 'chain' ? <ChainComposer options={options} req={req} onStart={onStartChain} /> : (<>
      <p className="screen__lede">{t('mission.lede')}</p>
      <textarea className="newgoal__textarea" autoFocus rows={3} value={text} placeholder={t('mission.placeholder')} onChange={(e) => setText(e.target.value)} />
      <div className="mission__compose-ids" role="group" aria-label={t('mission.pickIdentities')}>
        {options.length === 0 && <span className="muted-14">{t('mission.noIdentities')}</span>}
        {free.length > 1 && (
          <label className="mission__id mission__id--all">
            <input type="checkbox" checked={allOn} onChange={() => setTouched(toggleAll(options, picked))} />
            <span>{t('mission.pickAll')}</span>
            <span className="muted-14">{t('mission.selected', { count: chosen.length })}</span>
          </label>
        )}
        {options.map((o) => (
          <label key={o.id} className="mission__id" aria-disabled={o.disabled}>
            <input type="checkbox" value={o.id} disabled={o.disabled} checked={!o.disabled && picked.has(o.id)} onChange={() => flip(o.id)} />
            <span>{o.name} <span className="muted-14">{o.handle}</span></span>
            <span className="muted-14">{o.note}</span>
          </label>
        ))}
      </div>
      <div className="row-between" style={{ justifyContent: 'flex-end' }}>
        <Button size="lg" disabled={req.busy || chosen.length === 0} onClick={() => onStart(chosen, text)}>
          {req.busy ? t('mission.starting') : chosen.length > 1 ? t('mission.startMany', { count: chosen.length }) : t('mission.start')}
        </Button>
      </div>
      </>)}
      {req.error && <Notice>{t('mission.startFailed', { error: te(req.error) })}</Notice>}
    </div>
  );
}
