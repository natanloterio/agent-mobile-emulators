import type { Meter } from '../lib/resources';
import type { Screen } from '../types/fleet';
import { useI18n } from '../i18n/I18nProvider';
import { LanguageSelect } from './LanguageSelect';
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
  const { t } = useI18n();
  return (
    <aside className="sidebar">
      <div className="sidebar__brand"><Logo /><span className="sidebar__wordmark">Enxame</span></div>
      <nav className="sidebar__nav" aria-label={t('shell.nav.aria')}>
        {NAV_ITEMS.map((n) => (
          <button
            key={n.key}
            type="button"
            className={`navbtn${active === n.key ? ' navbtn--active' : ''}`}
            onClick={() => onNavigate(n.key)}
          >
            <span>{t(n.label)}</span>
            {n.key === 'report' && needsCount > 0 && <span className="navbtn__badge">{needsCount}</span>}
          </button>
        ))}
      </nav>
      <div className="sidebar__foot">
        <Meters meters={meters} />
        <LanguageSelect />
      </div>
    </aside>
  );
}
