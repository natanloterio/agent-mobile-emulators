import type { Locale } from '../locales';
import { cockpit } from './cockpit';
import { common } from './common';
import { device } from './device';
import { files } from './files';
import { goal } from './goal';
import { guide } from './guide';
import { identities } from './identities';
import { mission } from './mission';
import { onboarding } from './onboarding';
import { providers } from './providers';
import { report } from './report';
import { shell } from './shell';

/** Um arquivo por namespace, cada um com os seis idiomas: frentes paralelas não disputam o mesmo arquivo. */
const NAMESPACES = { shell, common, cockpit, device, goal, report, identities, providers, mission, onboarding, files, guide } as const;
type Namespaces = typeof NAMESPACES;
type KeysOf<N extends keyof Namespaces> = Extract<keyof Namespaces[N]['pt'], string>;

/** Chave completa: `<namespace>.<chave>` (ex.: `shell.nav.report`). */
export type MessageKey = { [N in keyof Namespaces]: `${N}.${KeysOf<N>}` }[keyof Namespaces];

/** Tabela plana `<namespace>.<chave>` → texto, por idioma. */
export function catalog(locale: Locale): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [ns, byLocale] of Object.entries(NAMESPACES)) {
    for (const [k, v] of Object.entries((byLocale as Record<Locale, Record<string, string>>)[locale])) out[`${ns}.${k}`] = v;
  }
  return out;
}

export const ALL_NAMESPACES = NAMESPACES;
