import type { Meter } from '../lib/resources';
import type { Screen } from '../types/fleet';
import { useI18n } from '../i18n/I18nProvider';
import { LanguageSelect } from './LanguageSelect';
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
      <div className="topbar__brand"><Logo size={24} /><span className="topbar__wordmark">Tapflock</span></div>
      <div className="topbar__meters">
        {meters.map((m) => (
          <span className="topbar__meter" key={m.label}><span>{m.label}</span><span>{m.value === '—' ? '—' : m.pct}</span></span>
        ))}
      </div>
      <LanguageSelect compact />
    </header>
  );
}

export function MobileBottomNav({ screen, needsCount, onNavigate }: Omit<MobileChromeProps, 'meters'>) {
  const active = activeNavKey(screen);
  const { t } = useI18n();
  return (
    <nav className="bottomnav" aria-label={t('shell.nav.aria')}>
      {NAV_ITEMS.map((n) => (
        <button
          key={n.key}
          type="button"
          className={`bottomnav__btn${active === n.key ? ' bottomnav__btn--active' : ''}`}
          onClick={() => onNavigate(n.key)}
        >
          <span>{t(n.short)}</span>
          {n.key === 'report' && needsCount > 0 && <span className="bottomnav__badge">{needsCount}</span>}
        </button>
      ))}
    </nav>
  );
}
