import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createI18n, type I18n } from './translate';
import { detectLocale, isLocale, LOCALE_TAGS, type Locale } from './locales';

const STORAGE_KEY = 'enxame.locale';

/** Escolha salva > idioma do sistema > português. localStorage pode falhar (modo privado): nunca derruba a tela. */
function initialLocale(): Locale {
  try { const saved = window.localStorage.getItem(STORAGE_KEY); if (isLocale(saved)) return saved; } catch { /* sem storage */ }
  return detectLocale(typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language]);
}

interface Ctx extends I18n { readonly setLocale: (l: Locale) => void }
const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { readonly children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  useEffect(() => {
    document.documentElement.lang = LOCALE_TAGS[locale];
    try { window.localStorage.setItem(STORAGE_KEY, locale); } catch { /* sem storage */ }
  }, [locale]);
  const value = useMemo<Ctx>(() => ({ ...createI18n(locale), setLocale }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): Ctx {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n fora do I18nProvider');
  return ctx;
}
