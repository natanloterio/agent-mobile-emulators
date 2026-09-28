import { useState, type FormEvent } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { useDaemonError } from '../i18n/useDaemonError';
import type { MessageKey } from '../i18n/messages';
import type { BaseAvdStatus, BasePhase } from '../live/types';
import { ipcErrorText } from '../onboarding/view';
import type { BaseStage } from './baseAvdStage';
import { Button } from './Button';
import { Notice } from './Notice';

const PHASES: readonly BasePhase[] = ['avd', 'boot', 'mcp', 'google', 'app', 'finish'];

/** Linha de fases: feitas, a atual (com % do download do app de controle) e as que faltam; nunca só cor. */
function Phases({ current, progress }: { readonly current: BasePhase | null; readonly progress: number | null }) {
  const { t } = useI18n();
  const at = current ? PHASES.indexOf(current) : -1;
  return (
    <ol className="baseprep__phases">
      {PHASES.map((p, i) => {
        const mark = i < at ? '✓' : i === at ? '→' : '·';
        return (
          <li key={p} className={i === at ? 'baseprep__phase--now' : i < at ? 'baseprep__phase--done' : undefined} aria-current={i === at ? 'step' : undefined}>
            <span aria-hidden="true" className="baseprep__mark">{mark}</span>
            {t(`identities.prep.phase.${p}` as MessageKey)}
            {i === at && p === 'mcp' && progress !== null && progress < 100 && <span className="baseprep__pct"> · {progress}%</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** `onSave` devolve se deu certo: a senha só é apagada do campo quando foi aceita. */
function GoogleForm({ onSave }: { readonly onSave: (email: string, password: string) => Promise<boolean> }) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { if (await onSave(email.trim(), password)) setPassword(''); } finally { setBusy(false); }
  };
  return (
    <form className="baseprep__form" onSubmit={(e) => void submit(e)}>
      <label>{t('identities.prep.email')}<input className="role__input" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <label>{t('identities.prep.password')}<input className="role__input" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
      <div><Button type="submit" disabled={busy || !email.trim() || !password}>{t(busy ? 'identities.prep.saving' : 'identities.prep.googleSave')}</Button></div>
    </form>
  );
}

/**
 * Celular-base preparado pelo próprio Tapflock (sem Android Studio): começar, acompanhar as fases, cadastrar a conta
 * Google quando pedida, seguir depois de uma verificação do Google e tentar de novo depois de uma falha.
 */
export function BasePrepCard({ base, stage }: { readonly base: BaseAvdStatus; readonly stage: BaseStage }) {
  const { t, locale } = useI18n();
  const te = useDaemonError();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bridge = window.tapflock;
  const [changing, setChanging] = useState(false);
  const call = async (fn: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true); setError(null);
    try { await fn(); return true; } catch (e) { setError(ipcErrorText(e)); return false; } finally { setBusy(false); }
  };
  const saveGoogle = async (e: string, p: string) => {
    const ok = await call(() => bridge!.base!.google(e, p));
    if (ok) setChanging(false);
    return ok;
  };
  const prepare = () => void call(() => bridge!.api!('POST', '/base/prepare', { lang: locale }));
  const prep = base.prep;

  if (stage === 'running') {
    return <section className="card card--white baseprep"><p className="baseprep__lede" role="status">{t('identities.base.closeFirst')}</p></section>;
  }
  const state = stage === 'missing' ? 'idle' : prep?.state ?? 'idle';
  const titleKey: MessageKey = state === 'needs-google' ? 'identities.prep.googleTitle'
    : state === 'needs-human' ? 'identities.prep.humanTitle'
    : state === 'failed' ? 'identities.prep.failedTitle'
    : state === 'running' ? 'identities.prep.runningTitle' : 'identities.prep.title';
  return (
    <section className={`card card--white baseprep${state === 'needs-human' || state === 'needs-google' ? ' baseprep--ask' : ''}`} aria-label={t(titleKey)}>
      <h3 className="baseprep__title">{t(titleKey)}</h3>
      {state === 'idle' && (
        <>
          <p className="baseprep__lede">{t('identities.prep.lede')}</p>
          <div><Button disabled={busy || !bridge?.api} onClick={prepare}>{t('identities.prep.start')}</Button></div>
        </>
      )}
      {state === 'running' && <p className="baseprep__lede">{t('identities.prep.window')}</p>}
      {state === 'needs-google' && (
        <>
          <p className="baseprep__lede">{t('identities.prep.googleLede')}</p>
          <GoogleForm onSave={saveGoogle} />
        </>
      )}
      {state === 'needs-human' && (
        <>
          <p className="baseprep__lede" role="status">{t('identities.prep.humanBody')}</p>
          {prep?.humanReason && <p className="baseprep__reason">{prep.humanReason}</p>}
          <div><Button variant="tertiary" disabled={busy} onClick={() => void call(() => bridge!.api!('POST', '/base/continue'))}>{t('identities.prep.continue')}</Button></div>
        </>
      )}
      {state === 'failed' && (
        <>
          {prep?.error && <Notice>{te(prep.error)}</Notice>}
          <div><Button disabled={busy} onClick={prepare}>{t('identities.prep.retry')}</Button></div>
        </>
      )}
      {/* Senha errada ou conta trocada: dá para corrigir sem sair do app; "Começar de novo" abandona a missão aberta. */}
      {(state === 'failed' || state === 'needs-human') && (
        <div className="baseprep__more">
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setChanging((v) => !v)} aria-expanded={changing}>{t('identities.prep.changeGoogle')}</Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void call(() => bridge!.api!('POST', '/base/reset'))}>{t('identities.prep.reset')}</Button>
        </div>
      )}
      {changing && (state === 'failed' || state === 'needs-human') && <GoogleForm onSave={saveGoogle} />}
      {state !== 'idle' && <Phases current={prep?.phase ?? null} progress={prep?.progress ?? null} />}
      {error && <Notice>{t('identities.prep.requestFailed', { error: te(error) })}</Notice>}
    </section>
  );
}
