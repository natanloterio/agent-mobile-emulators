import { Bar } from '../components/Bar';
import { Button } from '../components/Button';
import { Heading } from '../components/Heading';
import { PhoneMock } from '../components/PhoneMock';
import { Pill } from '../components/Pill';
import { CURRENT_GOAL_TEXT } from '../data/goals';
import type { VideoBus } from '../live/videoBus';
import type { Stat, TileVM } from '../state/selectors';
import './Cockpit.css';

interface CockpitProps {
  readonly tiles: readonly TileVM[];
  readonly goalStats: readonly Stat[];
  readonly goalPct: number;
  readonly showCost: boolean;
  readonly fullTiles: boolean;
  readonly isMobile: boolean;
  readonly onOpen: (index: number) => void;
  readonly onKill: () => void;
  readonly onNew: () => void;
  readonly bus?: VideoBus | null;
}

export function Cockpit({ tiles, goalStats, goalPct, showCost, fullTiles, isMobile, onOpen, onKill, onNew, bus }: CockpitProps) {
  return (
    <div className="screen">
      <header className="screen__header">
        <div className="screen__title">
          <Heading size={isMobile ? 'h3' : 'h2'}>Cockpit</Heading>
          <p className="screen__lede">Clique num device para ampliar e assumir o controle.</p>
        </div>
        <div className="screen__actions">
          <Button variant="secondary" onClick={onKill}>Kill switch</Button>
          <Button onClick={onNew}>Novo objetivo</Button>
        </div>
      </header>

      <section className="card card--grey card--shadow goal">
        <div className="goal__text">
          <span className="goal__kicker">Objetivo em execução · fan-out replicado</span>
          <span className="goal__title">{CURRENT_GOAL_TEXT}</span>
          <div className="goal__bar"><Bar pct={goalPct} /></div>
        </div>
        {goalStats.map((s) => (
          <div className="goal__stat" key={s.label}>
            <span className="goal__value">{s.value}</span>
            <span className="goal__label">{s.label}</span>
          </div>
        ))}
      </section>

      <section className="tiles">
        {tiles.map((t) => (
          <button type="button" className={`tile tile--${t.cardTone}`} key={t.id ?? t.name} onClick={() => onOpen(t.index)}>
            <PhoneMock
              variant="tile"
              handle={t.handle}
              streamLabel="320p · 4 fps"
              overlay={t.overlay || undefined}
              maxHeight={fullTiles ? '360px' : '260px'}
              videoId={t.id}
              bus={bus}
              screen={t.screen}
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
        ))}
      </section>
    </div>
  );
}
