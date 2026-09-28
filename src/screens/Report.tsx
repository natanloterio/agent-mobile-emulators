import { useEffect } from 'react';
import { Heading } from '../components/Heading';
import { Notice } from '../components/Notice';
import { localizePastRow } from '../data/goals';
import { useI18n } from '../i18n/I18nProvider';
import { useDaemonError } from '../i18n/useDaemonError';
import type { RequestStatus } from '../state/fleetReducer';
import type { PastGoalRow } from '../state/liveSelectors';
import type { CostRow, ReportCard, TileVM } from '../state/selectors';
import './Report.css';

interface ReportProps {
  readonly cards: readonly ReportCard[];
  readonly needsList: readonly TileVM[];
  readonly costRows: readonly CostRow[];
  /** null = ainda carregando (`GET /goals`). */
  readonly pastGoals: readonly PastGoalRow[] | null;
  readonly pastReq: RequestStatus;
  /** Muda quando o objetivo corrente muda de estado: a lista de anteriores é recarregada. */
  readonly goalKey: string;
  readonly isMobile: boolean;
  readonly onOpen: (index: number) => void;
  /** Só no vivo. */
  readonly onLoadGoals?: () => void;
}

function PastGoals({ rows, req }: { readonly rows: readonly PastGoalRow[] | null; readonly req: RequestStatus }) {
  const i18n = useI18n();
  const te = useDaemonError();
  const { t } = i18n;
  return (
    <div className="card card--white">
      <div className="report__list-head"><Heading size="h4">{t('report.past.title')}</Heading></div>
      {req.error && <Notice>{t('report.past.failed', { error: te(req.error) })}</Notice>}
      {rows === null && !req.error && <span className="report__empty">{t('report.past.loading')}</span>}
      {rows?.length === 0 && <span className="report__empty">{t('report.past.empty')}</span>}
      {rows?.map((row) => localizePastRow(row, i18n)).map((g) => (
        <div className="pastrow" key={g.key}>
          <span className="pastrow__text">{g.text}</span>
          <span>{g.pattern}</span>
          <span>{g.result}</span>
          <span className="pastrow__cost">{g.cost}</span>
        </div>
      ))}
    </div>
  );
}

export function Report({ cards, needsList, costRows, pastGoals, pastReq, goalKey, isMobile, onOpen, onLoadGoals }: ReportProps) {
  useEffect(() => { onLoadGoals?.(); }, [goalKey]);
  const { t, fmt } = useI18n();
  const cardLabel = (c: ReportCard) => (c.localize ? t(c.localize.labelKey) : c.label);
  const cardValue = (c: ReportCard) => (c.localize?.usd === undefined ? c.value : fmt.usd(c.localize.usd));
  return (
    <div className="screen report">
      <header className="screen__title">
        <Heading size={isMobile ? 'h3' : 'h2'}>{t('report.title')}</Heading>
        <p className="screen__lede">{t('report.lede')}</p>
      </header>

      <div className="report__cards">
        {cards.map((c) => (
          <div className={`card card--${c.tone} card--shadow report__card`} key={c.label}>
            <span className="report__big">{cardValue(c)}</span>
            <span className="report__label">{cardLabel(c)}</span>
          </div>
        ))}
      </div>

      <div className="report__two">
        <div className="card card--dark report__list">
          <div className="report__list-head"><Heading size="h4">{t('report.needs.title')}</Heading></div>
          {needsList.map((n) => (
            <div className="needrow" key={n.id ?? n.name}>
              <div className="needrow__text">
                <span className="needrow__name">{n.name} <span className="needrow__handle">{n.handle}</span></span>
                <span className="needrow__error">{n.error || n.overlay}</span>
              </div>
              <button type="button" className="needrow__btn" onClick={() => onOpen(n.index)}>{t('report.needs.open')}</button>
            </div>
          ))}
          {needsList.length === 0 && <span className="report__empty">{t('report.needs.empty')}</span>}
        </div>

        <div className="card card--white report__list">
          <div className="report__list-head"><Heading size="h4">{t('report.cost.title')}</Heading></div>
          {costRows.map((r) => (
            <div className="costrow" key={r.name}>
              <span>{r.name}</span>
              <div className="costrow__bar"><div className="costrow__fill" style={{ width: `${r.pct}%` }} /></div>
              <span className="costrow__value">{fmt.usd(r.cost)}</span>
            </div>
          ))}
          {costRows.length === 0 && <span className="report__empty">{t('report.cost.empty')}</span>}
          <span className="report__note">{t('report.cost.note')}</span>
        </div>
      </div>

      <PastGoals rows={pastGoals} req={pastReq} />
    </div>
  );
}
