import type { Meter } from '../lib/resources';
import type { Screen } from '../types/fleet';
import { Logo } from './Logo';
import { activeNavKey, NAV_ITEMS } from './navigation';

interface MobileChromeProps {
  readonly screen: Screen;
  readonly needsCount: number;
  readonly meters: readonly Meter[];
  readonly onNavigate: (screen: Screen) => void;
}

export function MobileTopbar({ meters }: Pick<MobileChromeProps, 'meters'>) {
  return (
    <header className="topbar">
      <div className="topbar__brand"><Logo size={24} /><span className="topbar__wordmark">Enxame</span></div>
      <div className="topbar__meters">
        {meters.map((m) => (
          <span className="topbar__meter" key={m.label}><span>{m.label}</span><span>{m.pct}</span></span>
        ))}
      </div>
    </header>
  );
}

export function MobileBottomNav({ screen, needsCount, onNavigate }: Omit<MobileChromeProps, 'meters'>) {
  const active = activeNavKey(screen);
  return (
    <nav className="bottomnav" aria-label="Principal">
      {NAV_ITEMS.map((n) => (
        <button
          key={n.key}
          type="button"
          className={`bottomnav__btn${active === n.key ? ' bottomnav__btn--active' : ''}`}
          onClick={() => onNavigate(n.key)}
        >
          <span>{n.short}</span>
          {n.key === 'report' && needsCount > 0 && <span className="bottomnav__badge">{needsCount}</span>}
        </button>
      ))}
    </nav>
  );
}
