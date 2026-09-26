import type { Screen } from '../types/fleet';

export interface NavItem {
  readonly key: Screen;
  readonly label: string;
  readonly short: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'cockpit', label: 'Cockpit', short: 'Cockpit' },
  { key: 'new', label: 'Novo objetivo', short: 'Novo' },
  { key: 'report', label: 'Relatório', short: 'Relatório' },
  { key: 'ids', label: 'Identidades', short: 'IDs' },
  { key: 'prov', label: 'Provedores', short: 'Modelos' },
];

/** A tela de device é um aprofundamento do cockpit; na navegação ela conta como cockpit. */
export function activeNavKey(screen: Screen): Screen {
  return screen === 'device' ? 'cockpit' : screen;
}
