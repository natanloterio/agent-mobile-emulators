import { useEffect, useState } from 'react';
import { BasePrepCard } from '../components/BasePrepCard';
import { baseBlocksProvision, baseStage } from '../components/baseAvdStage';
import { Button } from '../components/Button';
import { Heading } from '../components/Heading';
import { Notice } from '../components/Notice';
import { Pill } from '../components/Pill';
import { LIFECYCLE_ORDER } from '../data/identities';
import { useI18n } from '../i18n/I18nProvider';
import { useDaemonError } from '../i18n/useDaemonError';
import type { BaseAvdStatus } from '../live/types';
import type { RequestStatus } from '../state/fleetReducer';
import { lifecycleTone, type IdRow, type RowAction } from '../state/idRows';
import './Identities.css';

interface IdentitiesProps {
  readonly rows: readonly IdRow[];
  readonly isMobile: boolean;
  readonly provisionReq: RequestStatus;
  /** Só no vivo: AVD-base ausente trava o provisionamento e mostra o guia. */
  readonly baseAvd?: BaseAvdStatus | null;
  readonly onProvision: (pin: string) => void;
  /** Ações de linha exceto "Login feito", que pede o @ num campo inline antes de chamar `onLoginDone`. */
  readonly onAction: (row: IdRow, action: RowAction) => void;
  readonly onLoginDone: (id: string, handle: string) => void;
  readonly onRegisterPin: (id: string, pin: string) => void;
  /** Credenciais e login pelo daemon (só modo vivo; ausentes no demo). */
  readonly creds?: CredentialHandlers;
}

export interface CredentialHandlers {
  /** Recarrega os usernames salvos (ao abrir a tela). */
  readonly load: () => void;
  /** true = chaveiro ok, pode abrir o formulário; false = o motivo já aparece na linha. */
  readonly open: (id: string) => Promise<boolean>;
  readonly save: (id: string, username: string, password: string) => void;
  readonly forget: (id: string, name: string) => void;
  readonly login: (id: string) => void;
}

function DiskBar({ pct }: { readonly pct: number }) {
  return (
    <div className="disk-bar">
      <div className={`disk-bar__fill${pct > 70 ? ' disk-bar__fill--high' : ''}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

type InlineKind = 'login' | 'pin' | 'creds';

/** Usuário + senha; a senha só vive neste campo e é limpa ao salvar/cancelar. */
function CredForm({ onSubmit, onCancel }: { readonly onSubmit: (username: string, password: string) => void; readonly onCancel: () => void }) {
  const { t } = useI18n();
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  return (
    <form className="idrow__login" autoComplete="off" onSubmit={(e) => { e.preventDefault(); const p = pass; setPass(''); onSubmit(user, p); }}>
      <input className="idrow__input" value={user} onChange={(e) => setUser(e.target.value)} placeholder={t('identities.creds.userPlaceholder')}
        aria-label={t('identities.creds.userAria')} autoComplete="off" autoCapitalize="none" spellCheck={false} autoFocus />
      <input className="idrow__input" value={pass} onChange={(e) => setPass(e.target.value)} placeholder={t('identities.creds.passPlaceholder')}
        aria-label={t('identities.creds.passAria')} type="password" autoComplete="off" />
      <div className="idrow__login-btns">
        <Button size="sm" type="submit">{t('identities.creds.save')}</Button>
        <Button size="sm" variant="ghost" onClick={() => { setPass(''); onCancel(); }}>{t('identities.inline.cancel')}</Button>
      </div>
    </form>
  );
}

function InlineForm({ kind, onSubmit, onCancel }: { readonly kind: InlineKind; readonly onSubmit: (value: string) => void; readonly onCancel: () => void }) {
  const { t } = useI18n();
  const [handle, setHandle] = useState('');
  const pin = kind === 'pin';
  return (
    <form className="idrow__login" onSubmit={(e) => { e.preventDefault(); onSubmit(handle); }}>
      <input className="idrow__input" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder={t(pin ? 'identities.inline.pinPlaceholder' : 'identities.inline.handlePlaceholder')}
        aria-label={t(pin ? 'identities.inline.pinAria' : 'identities.inline.handleAria')} inputMode={pin ? 'numeric' : undefined} type={pin ? 'password' : 'text'} autoFocus />
      <div className="idrow__login-btns">
        <Button size="sm" type="submit">{t('identities.inline.confirm')}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>{t('identities.inline.cancel')}</Button>
      </div>
    </form>
  );
}

interface RowActionsProps {
  readonly row: IdRow; readonly logging: InlineKind | null; readonly mobile: boolean;
  readonly onPick: (a: RowAction) => void; readonly onLogin: (handle: string) => void; readonly onCancel: () => void;
  readonly onSaveCreds: (username: string, password: string) => void;
}

function RowActions({ row, logging, mobile, onPick, onLogin, onCancel, onSaveCreds }: RowActionsProps) {
  const { t } = useI18n();
  if (logging === 'creds') return <CredForm onSubmit={onSaveCreds} onCancel={onCancel} />;
  if (logging) return <InlineForm kind={logging} onSubmit={onLogin} onCancel={onCancel} />;
  if (row.actions.length === 0) return <span />;
  return (
    <div className="idrow__actions">
      {row.actions.map((a) => (
        <Button key={a.kind} variant="ghost" size="sm" className={mobile ? 'idcard__action' : undefined} disabled={row.busy} onClick={() => onPick(a)}>
          {!row.busy ? a.label : a.kind === 'autologin' && row.loginBusy ? t('identities.login.busy') : '…'}
        </Button>
      ))}
    </div>
  );
}

/** Ciclo de vida da linha; com o emulador subindo, diz isso (o ciclo só muda quando o boot termina). */
function LifecyclePill({ row }: { readonly row: IdRow }) {
  const { t } = useI18n();
  if (!row.booting) return <Pill tone={lifecycleTone(row.lc)}>{row.lc}</Pill>;
  return (
    <span className="idrow__booting" role="status" title={t('identities.booting.note')}>
      <Pill tone="green">{t('identities.booting.pill')}</Pill>
      <span className="idrow__booting-note">{t('identities.booting.note')}</span>
    </span>
  );
}

export function Identities({ rows, isMobile, provisionReq, baseAvd, onProvision, onAction, onLoginDone, onRegisterPin, creds }: IdentitiesProps) {
  const { t } = useI18n();
  const te = useDaemonError();
  const [inline, setInline] = useState<{ key: string; kind: InlineKind } | null>(null);
  const [newPin, setNewPin] = useState('');
  // Status das credenciais ao abrir a tela (set/clear recarregam pelas ações).
  const loadCreds = creds?.load;
  useEffect(() => { loadCreds?.(); }, [loadCreds]);
  const pick = (r: IdRow, a: RowAction) => {
    if (a.kind === 'login' || a.kind === 'pin') { setInline({ key: r.key, kind: a.kind }); return; }
    if (creds && r.id && (a.kind === 'creds' || a.kind === 'autologin' || a.kind === 'forget')) {
      const id = r.id;
      if (a.kind === 'creds') void creds.open(id).then((ok) => { if (ok) setInline({ key: r.key, kind: 'creds' }); });
      else if (a.kind === 'autologin') creds.login(id);
      else creds.forget(id, r.name);
      return;
    }
    onAction(r, a);
  };
  const submit = (r: IdRow, kind: InlineKind, value: string) => {
    if (r.id) (kind === 'pin' ? onRegisterPin : onLoginDone)(r.id, value);
    setInline(null);
  };
  const actionsOf = (r: IdRow) => {
    const kind = inline?.key === r.key ? inline.kind : null;
    const saveCreds = (u: string, p: string) => { if (r.id) creds?.save(r.id, u, p); setInline(null); };
    return <RowActions row={r} logging={kind} mobile={isMobile} onPick={(a) => pick(r, a)} onLogin={(v) => kind && submit(r, kind, v)} onCancel={() => setInline(null)} onSaveCreds={saveCreds} />;
  };
  const credLine = (r: IdRow) => r.credUser && <span className="idrow__cred">{t('identities.creds.saved', { username: r.credUser })}</span>;
  const loginNote = (r: IdRow) => r.loginNote && <Notice tone={r.loginNote.tone === 'ok' ? 'warn' : 'error'}>{r.loginNote.text}</Notice>;

  const stage = baseStage(baseAvd);
  const blocked = baseBlocksProvision(stage);

  return (
    <div className="screen">
      <header className="screen__header" style={{ alignItems: 'center' }}>
        <div className="screen__title">
          <Heading size={isMobile ? 'h3' : 'h2'}>{t('identities.title')}</Heading>
          <p className="screen__lede" style={{ maxWidth: 420 }}>{t('identities.lede')}</p>
        </div>
        <form className="ids__provision" onSubmit={(e) => { e.preventDefault(); onProvision(newPin); }}>
          <label className="ids__pin">
            <span>{t('identities.provision.pinLabel')}</span>
            <input className="idrow__input" value={newPin} onChange={(e) => setNewPin(e.target.value)} placeholder="1234"
              inputMode="numeric" type="password" autoComplete="off" />
          </label>
          <Button type="submit" disabled={provisionReq.busy || blocked} title={stage === 'running' ? t('identities.base.closeFirst') : stage ? t('identities.base.blocked') : undefined}>
            {t(provisionReq.busy ? 'identities.provision.busy' : 'identities.provision.submit')}
          </Button>
        </form>
      </header>
      {provisionReq.error && <Notice>{t('identities.provision.failed', { error: te(provisionReq.error) })}</Notice>}
      {stage && baseAvd && <BasePrepCard base={baseAvd} stage={stage} />}

      <div className="ids__cycle">
        <span className="ids__cycle-label">{t('identities.cycle.label')}</span>
        {LIFECYCLE_ORDER.map((lc) => (
          <Pill key={lc} tone={lc === 'running' ? 'green' : lc === 'banned' ? 'dark' : 'white'}>{lc}</Pill>
        ))}
      </div>

      {rows.length === 0 && !stage && <div className="card card--white empty"><span className="empty__title">{t('identities.empty.title')}</span><span>{t('identities.empty.body')}</span></div>}

      {isMobile ? (
        <div className="ids__cards">
          {rows.map((r) => (
            <div className={`idcard${r.dimmed ? ' idcard--dimmed' : ''}`} key={r.key}>
              <div className="idcard__head">
                <div className="idrow__id"><span className="idcard__name">{r.name}</span><span className="idrow__handle">{r.handle}</span>{credLine(r)}</div>
                <LifecyclePill row={r} />
              </div>
              <div className="idcard__grid">
                <div className="idcard__cell"><span className="idcard__cell-label">{t('identities.col.app')}</span><span>{r.app} {r.version}</span></div>
                <div className="idcard__cell"><span className="idcard__cell-label">{t('identities.col.snapshot')}</span><span>{r.snap}</span></div>
                <div className="idcard__cell" style={{ gap: 5 }}><span className="idcard__cell-label">{t('identities.card.disk', { disk: r.disk })}</span><DiskBar pct={r.diskPct} /></div>
                <div className="idcard__cell"><span className="idcard__cell-label">{t('identities.col.ports')}</span><span className="idrow__ports">{r.ports}</span></div>
              </div>
              {actionsOf(r)}
              {loginNote(r)}
              {r.error && <Notice>{te(r.error)}</Notice>}
            </div>
          ))}
        </div>
      ) : rows.length > 0 && (
        <div className="card card--white ids__table">
          <div className="idrow idrow--head">
            <span>{t('identities.col.identity')}</span><span>{t('identities.col.cycle')}</span><span>{t('identities.col.app')}</span>
            <span>{t('identities.col.snapshot')}</span><span>{t('identities.col.disk')}</span><span>{t('identities.col.ports')}</span><span />
          </div>
          {rows.map((r) => (
            <div className={`idrow idrow--body${r.dimmed ? ' idrow--dimmed' : ''}`} key={r.key}>
              <div className="idrow__id"><span className="idrow__name">{r.name}</span><span className="idrow__handle">{r.handle}</span>{credLine(r)}</div>
              <LifecyclePill row={r} />
              <span>{r.app} <span className="idrow__version">{r.version}</span></span>
              <span>{r.snap}</span>
              <div className="idrow__disk"><span className="idrow__disk-label">{r.disk}</span><DiskBar pct={r.diskPct} /></div>
              <span className="idrow__ports">{r.ports}</span>
              {actionsOf(r)}
              {r.loginNote && <div className="idrow__error">{loginNote(r)}</div>}
              {r.error && <div className="idrow__error"><Notice>{te(r.error)}</Notice></div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
