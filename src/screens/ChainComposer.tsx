import { useState } from 'react';
import { Button } from '../components/Button';
import { useI18n } from '../i18n/I18nProvider';
import type { RequestStatus } from '../state/fleetReducer';
import { addStep, canStartChain, initialSteps, MAX_STEPS, MIN_STEPS, optionsForStep, removeStep, setStep, type ChainStepDraft } from './chainSteps';
import type { MissionIdentityOption } from './missionPick';
import './Mission.css';

/**
 * Sequência com arquivo (spec arquivos §Interface): uma etapa por conta, na ordem. O daemon roda a primeira, espera ela
 * terminar e leva o arquivo que ela baixou para o celular da seguinte.
 */
export function ChainComposer({ options, req, onStart }: {
  readonly options: readonly MissionIdentityOption[]; readonly req: RequestStatus;
  readonly onStart: (steps: readonly ChainStepDraft[]) => void;
}) {
  const { t } = useI18n();
  const [touched, setTouched] = useState<readonly ChainStepDraft[] | null>(null);
  // Sem edição ainda (as opções chegam com o snapshot): as duas primeiras contas livres.
  const steps = touched ?? initialSteps(options);
  const edit = (next: readonly ChainStepDraft[]) => setTouched(next);
  return (
    <>
      <p className="screen__lede">{t('files.chain.lede')}</p>
      <ol className="chain">
        {steps.map((s, k) => (
          <li key={k} className="chain__step">
            <div className="chain__head">
              <span className="chain__n">{t('files.chain.step', { n: k + 1 })}</span>
              <select className="chain__pick" aria-label={t('files.chain.pick')} value={s.identityId} onChange={(e) => edit(setStep(steps, k, { identityId: e.target.value }))}>
                <option value="">{t('files.chain.pick')}</option>
                {optionsForStep(options, steps, k).map((o) => <option key={o.id} value={o.id}>{o.name} · {o.handle}</option>)}
              </select>
              {steps.length > MIN_STEPS && <Button variant="ghost" size="sm" onClick={() => edit(removeStep(steps, k))}>{t('files.chain.remove')}</Button>}
            </div>
            <textarea
              className="newgoal__textarea" rows={2} value={s.text}
              placeholder={t(k === 0 ? 'files.chain.placeholder.first' : 'files.chain.placeholder.next')}
              onChange={(e) => edit(setStep(steps, k, { text: e.target.value }))}
            />
            {k < steps.length - 1 && <span className="chain__handoff">{t('files.chain.handoff', { n: k + 2 })}</span>}
          </li>
        ))}
      </ol>
      <div className="row-between">
        <Button variant="secondary" disabled={steps.length >= MAX_STEPS} onClick={() => edit(addStep(steps))}>{t('files.chain.add')}</Button>
        <Button size="lg" disabled={req.busy || !canStartChain(options, steps)} onClick={() => onStart(steps)}>
          {req.busy ? t('mission.starting') : t('files.chain.start')}
        </Button>
      </div>
    </>
  );
}
