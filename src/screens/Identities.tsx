import { useState } from 'react';
import { Button } from '../components/Button';
import { Heading } from '../components/Heading';
import { Notice } from '../components/Notice';
import { Pill } from '../components/Pill';
import { LIFECYCLE_ORDER } from '../data/identities';
import { useI18n } from '../i18n/I18nProvider';
import type { RequestStatus } from '../state/fleetReducer';
import { lifecycleTone, type IdRow, type RowAction } from '../state/idRows';
import './Identities.css';

interface IdentitiesProps {
  readonly rows: readonly IdRow[];
  readonly isMobile: boolean;
  readonly provisionReq: RequestStatus;
  readonly onProvision: (pin: string) => void;
  /** Ações de linha exceto "Login feito", que pede o @ num campo inline antes de chamar `onLoginDone`. */
  readonly onAction: (row: IdRow, action: RowAction) => void;
  readonly onLoginDone: (id: string, handle: string) => void;
  readonly onRegisterPin: (id: string, pin: string) => void;
}

function DiskBar({ pct }: { readonly pct: number }) {
  return (
    <div className="disk-bar">
      <div className={`disk-bar__fill${pct > 70 ? ' disk-bar__fill--high' : ''}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

type InlineKind = 'login' | 'pin';

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
}

function RowActions({ row, logging, mobile, onPick, onLogin, onCancel }: RowActionsProps) {
  if (logging) return <InlineForm kind={logging} onSubmit={onLogin} onCancel={onCancel} />;
  if (row.actions.length === 0) return <span />;
  return (
    <div className="idrow__actions">
      {row.actions.map((a) => (
        <Button key={a.kind} variant="ghost" size="sm" className={mobile ? 'idcard__action' : undefined} disabled={row.busy} onClick={() => onPick(a)}>
          {row.busy ? '…' : a.label}
        </Button>
      ))}
    </div>
  );
}

export function Identities({ rows, isMobile, provisionReq, onProvision, onAction, onLoginDone, onRegisterPin }: IdentitiesProps) {
  const { t } = useI18n();
  const [inline, setInline] = useState<{ key: string; kind: InlineKind } | null>(null);
  const [newPin, setNewPin] = useState('');
  const pick = (r: IdRow, a: RowAction) => (a.kind === 'login' || a.kind === 'pin' ? setInline({ key: r.key, kind: a.kind }) : onAction(r, a));
  const submit = (r: IdRow, kind: InlineKind, value: string) => {
    if (r.id) (kind === 'pin' ? onRegisterPin : onLoginDone)(r.id, value);
    setInline(null);
  };
  const actionsOf = (r: IdRow) => {
    const kind = inline?.key === r.key ? inline.kind : null;
    return <RowActions row={r} logging={kind} mobile={isMobile} onPick={(a) => pick(r, a)} onLogin={(v) => kind && submit(r, kind, v)} onCancel={() => setInline(null)} />;
  };

  return (
    <div className="screen">
      <header className="screen__header" style={{ alignItems: 'center' }}>
        <div className="screen__title">
          <Heading size={isMobile ? 'h3' : 'h2'}>{t('identities.title')}</Heading>
          <p className="screen__lede" style={{ maxWidth: 420 }}>{t('identities.lede')}</p>
        </div>
        <form className="ids__provision" onSubmit={(e) => { e.preventDefault(); onProvision(newPin); }}>
          <input className="idrow__input" value={newPin} onChange={(e) => setNewPin(e.target.value)} placeholder={t('identities.provision.pinPlaceholder')}
            aria-label={t('identities.provision.pinAria')} inputMode="numeric" type="password" />
          <Button type="submit" disabled={provisionReq.busy}>{t(provisionReq.busy ? 'identities.provision.busy' : 'identities.provision.submit')}</Button>
        </form>
      </header>
      {provisionReq.error && <Notice>{t('identities.provision.failed', { error: provisionReq.error })}</Notice>}

      <div className="ids__cycle">
        <span className="ids__cycle-label">{t('identities.cycle.label')}</span>
        {LIFECYCLE_ORDER.map((lc) => (
          <Pill key={lc} tone={lc === 'running' ? 'green' : lc === 'banned' ? 'dark' : 'white'}>{lc}</Pill>
        ))}
      </div>

      {rows.length === 0 && <div className="card card--white empty"><span className="empty__title">{t('identities.empty.title')}</span><span>{t('identities.empty.body')}</span></div>}

      {isMobile ? (
        <div className="ids__cards">
          {rows.map((r) => (
            <div className={`idcard${r.dimmed ? ' idcard--dimmed' : ''}`} key={r.key}>
              <div className="idcard__head">
                <div className="idrow__id"><span className="idcard__name">{r.name}</span><span className="idrow__handle">{r.handle}</span></div>
                <Pill tone={lifecycleTone(r.lc)}>{r.lc}</Pill>
              </div>
              <div className="idcard__grid">
                <div className="idcard__cell"><span className="idcard__cell-label">{t('identities.col.app')}</span><span>{r.app} {r.version}</span></div>
                <div className="idcard__cell"><span className="idcard__cell-label">{t('identities.col.snapshot')}</span><span>{r.snap}</span></div>
                <div className="idcard__cell" style={{ gap: 5 }}><span className="idcard__cell-label">{t('identities.card.disk', { disk: r.disk })}</span><DiskBar pct={r.diskPct} /></div>
                <div className="idcard__cell"><span className="idcard__cell-label">{t('identities.col.ports')}</span><span className="idrow__ports">{r.ports}</span></div>
              </div>
              {actionsOf(r)}
              {r.error && <Notice>{r.error}</Notice>}
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
              <div className="idrow__id"><span className="idrow__name">{r.name}</span><span className="idrow__handle">{r.handle}</span></div>
              <Pill tone={lifecycleTone(r.lc)}>{r.lc}</Pill>
              <span>{r.app} <span className="idrow__version">{r.version}</span></span>
              <span>{r.snap}</span>
              <div className="idrow__disk"><span className="idrow__disk-label">{r.disk}</span><DiskBar pct={r.diskPct} /></div>
              <span className="idrow__ports">{r.ports}</span>
              {actionsOf(r)}
              {r.error && <div className="idrow__error"><Notice>{r.error}</Notice></div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
