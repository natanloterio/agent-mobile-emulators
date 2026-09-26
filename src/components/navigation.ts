import type { Screen } from '../types/fleet';

import type { MessageKey } from '../i18n/messages';

export interface NavItem {
  readonly key: Screen;
  /** Chaves de tradução (namespace `shell`). */
  readonly label: MessageKey;
  readonly short: MessageKey;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'cockpit', label: 'shell.nav.cockpit', short: 'shell.nav.cockpit' },
  { key: 'new', label: 'shell.nav.new', short: 'shell.nav.new.short' },
  { key: 'report', label: 'shell.nav.report', short: 'shell.nav.report' },
  { key: 'ids', label: 'shell.nav.ids', short: 'shell.nav.ids.short' },
  { key: 'prov', label: 'shell.nav.prov', short: 'shell.nav.prov.short' },
];

/** A tela de device é um aprofundamento do cockpit; na navegação ela conta como cockpit. */
export function activeNavKey(screen: Screen): Screen {
  return screen === 'device' ? 'cockpit' : screen;
}
