import type { Meter } from '../lib/resources';
import type { Screen } from '../types/fleet';
import { Logo } from './Logo';
import { Meters } from './Meters';
import { activeNavKey, NAV_ITEMS } from './navigation';

interface SidebarProps {
  readonly screen: Screen;
  readonly needsCount: number;
  readonly meters: readonly Meter[];
  readonly onNavigate: (screen: Screen) => void;
}

export function Sidebar({ screen, needsCount, meters, onNavigate }: SidebarProps) {
  const active = activeNavKey(screen);
  return (
    <aside className="sidebar">
      <div className="sidebar__brand"><Logo /><span className="sidebar__wordmark">Enxame</span></div>
      <nav className="sidebar__nav" aria-label="Principal">
        {NAV_ITEMS.map((n) => (
          <button
            key={n.key}
            type="button"
            className={`navbtn${active === n.key ? ' navbtn--active' : ''}`}
            onClick={() => onNavigate(n.key)}
          >
            <span>{n.label}</span>
            {n.key === 'report' && needsCount > 0 && <span className="navbtn__badge">{needsCount}</span>}
          </button>
        ))}
      </nav>
      <Meters meters={meters} />
    </aside>
  );
}
