import type { ReactNode } from 'react';
import type { HostOs } from '../lib/platformMeters';
import type { Meter } from '../lib/resources';
import type { Screen } from '../types/fleet';
import { useI18n } from '../i18n/I18nProvider';
import { LanguageSelect } from './LanguageSelect';
import { Logo } from './Logo';
import { activeNavKey, NAV_ITEMS } from './navigation';
import { HostResources } from './resources/HostResources';

interface SidebarProps {
  readonly screen: Screen;
  readonly needsCount: number;
  readonly meters: readonly Meter[];
  readonly host: { readonly os: HostOs; readonly appleSilicon: boolean };
  readonly onNavigate: (screen: Screen) => void;
  /** Botão Ajuda do Guia (spec guia §3.1), acima dos recursos do host. */
  readonly help?: ReactNode;
}

export function Sidebar({ screen, needsCount, meters, host, onNavigate, help }: SidebarProps) {
  const active = activeNavKey(screen);
  const { t } = useI18n();
  return (
    <aside className="sidebar">
      <div className="sidebar__brand"><Logo size={40} /><span className="sidebar__wordmark">TapFlock</span></div>
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
        {help}
        <HostResources meters={meters} host={host} />
        <LanguageSelect />
      </div>
    </aside>
  );
}
