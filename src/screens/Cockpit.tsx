import { Bar } from '../components/Bar';
import { Button } from '../components/Button';
import { Heading } from '../components/Heading';
import { Notice } from '../components/Notice';
import { PhoneMock } from '../components/PhoneMock';
import { Pill } from '../components/Pill';
import { useI18n } from '../i18n/I18nProvider';
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
  /** Modo vivo sem identidades: 'connecting' (sem snapshot ainda), 'down' (o daemon não subiu; o banner explica) ou 'empty'. */
  readonly empty: 'connecting' | 'down' | 'empty' | null;
  readonly killError: string | null;
  readonly onOpen: (index: number) => void;
  readonly onKill: () => void;
  readonly onNew: () => void;
  readonly onProvision: () => void;
  readonly bus?: VideoBus | null;
  /** Vivo, sem AVD-base: o primeiro passo é prepará-lo (o CTA vai para Identidades, onde está o guia). */
  readonly baseMissing?: boolean;
}

function EmptyFleet({ connecting, baseMissing, onProvision }: { readonly connecting: boolean; readonly baseMissing: boolean; readonly onProvision: () => void }) {
  const { t } = useI18n();
  if (connecting) return <div className="card card--white empty"><span className="empty__title">{t('cockpit.empty.connecting')}</span></div>;
  return (
    <div className="card card--white empty">
      <span className="empty__title">{t('cockpit.empty.title')}</span>
      <span>{t(baseMissing ? 'cockpit.empty.bodyBase' : 'cockpit.empty.body')}</span>
      <Button onClick={onProvision}>{t(baseMissing ? 'identities.base.blocked' : 'cockpit.empty.cta')}</Button>
    </div>
  );
}

function Tile({ t, fullTiles, showCost, bus, onOpen }: { readonly t: TileVM; readonly fullTiles: boolean; readonly showCost: boolean; readonly bus?: VideoBus | null; readonly onOpen: (i: number) => void }) {
  const { t: tr } = useI18n();
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
            <span>{t.budget === null ? tr('cockpit.tile.stepNoBudget', { steps: t.steps }) : tr('cockpit.tile.step', { steps: t.steps, budget: t.budget })}</span>
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
  const { t } = useI18n();
  return (
    <div className="screen">
      <header className="screen__header">
        <div className="screen__title">
          <Heading size={isMobile ? 'h3' : 'h2'}>{t('shell.nav.cockpit')}</Heading>
          {!empty && <p className="screen__lede">{t('cockpit.lede')}</p>}
        </div>
        {/* Sem frota não há o que parar nem a quem dar objetivo: o único próximo passo é o do cartão vazio. */}
        {!empty && (
          <div className="screen__actions">
            <Button variant="secondary" onClick={p.onKill}>Kill switch</Button>
            <Button onClick={p.onNew}>{t('cockpit.newGoal')}</Button>
          </div>
        )}
      </header>
      {killError && <Notice>{t('cockpit.killFailed', { error: killError })}</Notice>}

      {!empty && <section className="card card--grey card--shadow goal">
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
      </section>}

      {empty === 'down' ? null : empty ? (
        <EmptyFleet connecting={empty === 'connecting'} baseMissing={!!p.baseMissing} onProvision={p.onProvision} />
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
