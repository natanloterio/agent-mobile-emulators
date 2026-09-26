import { useState } from 'react';
import { Button } from '../components/Button';
import { Heading } from '../components/Heading';
import { Notice } from '../components/Notice';
import { Pill } from '../components/Pill';
import { LIFECYCLE_ORDER } from '../data/identities';
import type { RequestStatus } from '../state/fleetReducer';
import { lifecycleTone, type IdRow, type RowAction } from '../state/idRows';
import './Identities.css';

interface IdentitiesProps {
  readonly rows: readonly IdRow[];
  readonly isMobile: boolean;
  readonly provisionReq: RequestStatus;
  readonly onProvision: () => void;
  /** Ações de linha exceto "Login feito", que pede o @ num campo inline antes de chamar `onLoginDone`. */
  readonly onAction: (row: IdRow, action: RowAction) => void;
  readonly onLoginDone: (id: string, handle: string) => void;
}

function DiskBar({ pct }: { readonly pct: number }) {
  return (
    <div className="disk-bar">
      <div className={`disk-bar__fill${pct > 70 ? ' disk-bar__fill--high' : ''}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function LoginForm({ onSubmit, onCancel }: { readonly onSubmit: (handle: string) => void; readonly onCancel: () => void }) {
  const [handle, setHandle] = useState('');
  return (
    <form className="idrow__login" onSubmit={(e) => { e.preventDefault(); onSubmit(handle); }}>
      <input className="idrow__input" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@conta" aria-label="@ da conta logada" autoFocus />
      <div className="idrow__login-btns">
        <Button size="sm" type="submit">Confirmar</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>
      </div>
    </form>
  );
}

interface RowActionsProps {
  readonly row: IdRow; readonly logging: boolean; readonly mobile: boolean;
  readonly onPick: (a: RowAction) => void; readonly onLogin: (handle: string) => void; readonly onCancel: () => void;
}

function RowActions({ row, logging, mobile, onPick, onLogin, onCancel }: RowActionsProps) {
  if (logging) return <LoginForm onSubmit={onLogin} onCancel={onCancel} />;
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

export function Identities({ rows, isMobile, provisionReq, onProvision, onAction, onLoginDone }: IdentitiesProps) {
  const [loginFor, setLoginFor] = useState<string | null>(null);
  const pick = (r: IdRow, a: RowAction) => (a.kind === 'login' ? setLoginFor(r.key) : onAction(r, a));
  const login = (r: IdRow, handle: string) => { if (r.id) onLoginDone(r.id, handle); setLoginFor(null); };
  const actionsOf = (r: IdRow) => (
    <RowActions row={r} logging={loginFor === r.key} mobile={isMobile} onPick={(a) => pick(r, a)} onLogin={(h) => login(r, h)} onCancel={() => setLoginFor(null)} />
  );

  return (
    <div className="screen">
      <header className="screen__header" style={{ alignItems: 'center' }}>
        <div className="screen__title">
          <Heading size={isMobile ? 'h3' : 'h2'}>Identidades</Heading>
          <p className="screen__lede" style={{ maxWidth: 420 }}>Cada identidade é um AVD que pertence a uma conta e envelhece com ela.</p>
        </div>
        <Button disabled={provisionReq.busy} onClick={onProvision}>{provisionReq.busy ? 'Clonando AVD…' : 'Provisionar identidade'}</Button>
      </header>
      {provisionReq.error && <Notice>Provisionamento falhou: {provisionReq.error}</Notice>}

      <div className="ids__cycle">
        <span className="ids__cycle-label">Ciclo:</span>
        {LIFECYCLE_ORDER.map((lc) => (
          <Pill key={lc} tone={lc === 'running' ? 'green' : lc === 'banned' ? 'dark' : 'white'}>{lc}</Pill>
        ))}
      </div>

      {rows.length === 0 && <div className="card card--white empty"><span className="empty__title">Nenhuma identidade ainda.</span><span>Provisione a primeira: o daemon clona o AVD-base.</span></div>}

      {isMobile ? (
        <div className="ids__cards">
          {rows.map((r) => (
            <div className={`idcard${r.dimmed ? ' idcard--dimmed' : ''}`} key={r.key}>
              <div className="idcard__head">
                <div className="idrow__id"><span className="idcard__name">{r.name}</span><span className="idrow__handle">{r.handle}</span></div>
                <Pill tone={lifecycleTone(r.lc)}>{r.lc}</Pill>
              </div>
              <div className="idcard__grid">
                <div className="idcard__cell"><span className="idcard__cell-label">App alvo</span><span>{r.app} {r.version}</span></div>
                <div className="idcard__cell"><span className="idcard__cell-label">Snapshot</span><span>{r.snap}</span></div>
                <div className="idcard__cell" style={{ gap: 5 }}><span className="idcard__cell-label">Disco · {r.disk}</span><DiskBar pct={r.diskPct} /></div>
                <div className="idcard__cell"><span className="idcard__cell-label">Portas</span><span className="idrow__ports">{r.ports}</span></div>
              </div>
              {actionsOf(r)}
              {r.error && <Notice>{r.error}</Notice>}
            </div>
          ))}
        </div>
      ) : rows.length > 0 && (
        <div className="card card--white ids__table">
          <div className="idrow idrow--head">
            <span>Identidade</span><span>Ciclo</span><span>App alvo</span><span>Snapshot</span><span>Disco</span><span>Portas</span><span />
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
