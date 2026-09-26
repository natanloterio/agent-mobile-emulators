import { Bar } from '../components/Bar';
import { Button } from '../components/Button';
import { Heading } from '../components/Heading';
import { Notice } from '../components/Notice';
import { PhoneMock } from '../components/PhoneMock';
import { Pill } from '../components/Pill';
import type { VideoBus } from '../live/videoBus';
import type { GoalHeader } from '../state/liveSelectors';
import type { Stat, TileVM } from '../state/selectors';
import './Cockpit.css';

interface CockpitProps {
  readonly tiles: readonly TileVM[];
  readonly goalHeader: GoalHeader;
  readonly goalStats: readonly Stat[];
  readonly goalPct: number;
  readonly showCost: boolean;
  readonly fullTiles: boolean;
  readonly isMobile: boolean;
  /** Modo vivo sem identidades: 'connecting' (sem snapshot ainda) ou 'empty'. */
  readonly empty: 'connecting' | 'empty' | null;
  readonly killError: string | null;
  readonly onOpen: (index: number) => void;
  readonly onKill: () => void;
  readonly onNew: () => void;
  readonly onProvision: () => void;
  readonly bus?: VideoBus | null;
}

function EmptyFleet({ connecting, onProvision }: { readonly connecting: boolean; readonly onProvision: () => void }) {
  if (connecting) return <div className="card card--white empty"><span className="empty__title">Conectando ao daemon…</span></div>;
  return (
    <div className="card card--white empty">
      <span className="empty__title">Nenhuma identidade na frota.</span>
      <span>Cada identidade é um AVD preso a uma conta. Provisione a primeira para começar.</span>
      <Button onClick={onProvision}>Ir para Identidades → Provisionar</Button>
    </div>
  );
}

function Tile({ t, fullTiles, showCost, bus, onOpen }: { readonly t: TileVM; readonly fullTiles: boolean; readonly showCost: boolean; readonly bus?: VideoBus | null; readonly onOpen: (i: number) => void }) {
  return (
    <button type="button" className={`tile tile--${t.cardTone}`} onClick={() => onOpen(t.index)}>
      <PhoneMock
        variant="tile"
        handle={t.handle}
        streamLabel={t.streamLabel}
        overlay={t.overlay || undefined}
        maxHeight={fullTiles ? '360px' : '260px'}
        videoId={t.id}
        bus={bus}
        screen={t.screen}
        video={t.video}
      />
      <div className="tile__head">
        <span className="tile__name">{t.name}</span>
        <Pill tone={t.pillTone} greenBorder={t.pillGreenBorder}>{t.stateLabel}</Pill>
      </div>
      {fullTiles && (
        <div className="tile__meta">
          <span>{t.app} · {t.task}</span>
          <div className="row-between">
            <span>Passo {t.steps}/{t.budget}</span>
            {showCost && <span>{t.costFmt}</span>}
          </div>
          {t.error && <span className="tile__error">{t.error}</span>}
        </div>
      )}
    </button>
  );
}

export function Cockpit(p: CockpitProps) {
  const { tiles, goalHeader, goalStats, goalPct, isMobile, empty, killError } = p;
  return (
    <div className="screen">
      <header className="screen__header">
        <div className="screen__title">
          <Heading size={isMobile ? 'h3' : 'h2'}>Cockpit</Heading>
          <p className="screen__lede">Clique num device para ampliar e assumir o controle.</p>
        </div>
        <div className="screen__actions">
          <Button variant="secondary" onClick={p.onKill}>Kill switch</Button>
          <Button onClick={p.onNew}>Novo objetivo</Button>
        </div>
      </header>
      {killError && <Notice>Kill switch falhou: {killError}</Notice>}

      <section className="card card--grey card--shadow goal">
        <div className="goal__text">
          <span className="goal__kicker">{goalHeader.kicker}</span>
          <span className="goal__title">{goalHeader.title}</span>
          <div className="goal__bar"><Bar pct={goalPct} /></div>
        </div>
        {goalStats.map((s) => (
          <div className="goal__stat" key={s.label}>
            <span className="goal__value">{s.value}</span>
            <span className="goal__label">{s.label}</span>
          </div>
        ))}
      </section>

      {empty ? (
        <EmptyFleet connecting={empty === 'connecting'} onProvision={p.onProvision} />
      ) : (
        <section className="tiles">
          {tiles.map((t) => (
            <Tile key={t.id ?? t.name} t={t} fullTiles={p.fullTiles} showCost={p.showCost} bus={p.bus} onOpen={p.onOpen} />
          ))}
        </section>
      )}
    </div>
  );
}
