import { Button } from '../components/Button';
import { Heading } from '../components/Heading';
import { Pill } from '../components/Pill';
import { LIFECYCLE_ORDER } from '../data/identities';
import { lifecycleTone, type IdRow } from '../state/selectors';
import './Identities.css';

interface IdentitiesProps {
  readonly rows: readonly IdRow[];
  readonly isMobile: boolean;
  readonly onProvision: () => void;
  readonly onOpen: (index: number) => void;
  readonly onExtraAction: (index: number) => void;
}

function DiskBar({ pct }: { readonly pct: number }) {
  return (
    <div className="disk-bar">
      <div className={`disk-bar__fill${pct > 70 ? ' disk-bar__fill--high' : ''}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Identities({ rows, isMobile, onProvision, onOpen, onExtraAction }: IdentitiesProps) {
  const act = (r: IdRow) => {
    if (!r.onAction) return;
    if (r.onAction.kind === 'open') onOpen(r.onAction.index);
    else onExtraAction(r.onAction.index);
  };

  return (
    <div className="screen">
      <header className="screen__header" style={{ alignItems: 'center' }}>
        <div className="screen__title">
          <Heading size={isMobile ? 'h3' : 'h2'}>Identidades</Heading>
          <p className="screen__lede" style={{ maxWidth: 420 }}>Cada identidade é um AVD que pertence a uma conta e envelhece com ela.</p>
        </div>
        <Button onClick={onProvision}>Provisionar identidade</Button>
      </header>

      <div className="ids__cycle">
        <span className="ids__cycle-label">Ciclo:</span>
        {LIFECYCLE_ORDER.map((lc) => (
          <Pill key={lc} tone={lc === 'running' ? 'green' : lc === 'banned' ? 'dark' : 'white'}>{lc}</Pill>
        ))}
      </div>

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
              {r.action && <Button variant="ghost" size="sm" className="idcard__action" onClick={() => act(r)}>{r.action}</Button>}
            </div>
          ))}
        </div>
      ) : (
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
              {r.action ? <Button variant="ghost" size="sm" onClick={() => act(r)}>{r.action}</Button> : <span />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
