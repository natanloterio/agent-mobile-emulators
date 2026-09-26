/** Idiomas da interface. `pt` é o dicionário-fonte: os demais são checados contra ele pelo TypeScript. */
export const LOCALES = ['pt', 'en', 'es', 'fr', 'de', 'zh'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'pt';

/** Nome de cada idioma nele mesmo (o seletor mostra assim). */
export const LOCALE_NAMES: Readonly<Record<Locale, string>> = {
  pt: 'Português', en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch', zh: '中文',
};

/** Tag BCP 47 para `Intl` (números, moeda, datas) e para o `lang` do documento. */
export const LOCALE_TAGS: Readonly<Record<Locale, string>> = {
  pt: 'pt-BR', en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', zh: 'zh-CN',
};

export const isLocale = (x: unknown): x is Locale => typeof x === 'string' && (LOCALES as readonly string[]).includes(x);

/** Primeiro idioma suportado da lista do sistema (`navigator.languages`), pelo prefixo: `pt-BR` → pt, `zh-Hans-CN` → zh. */
export function detectLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split(/[-_]/)[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}
