import { catalog, type MessageKey } from './messages';
import { DEFAULT_LOCALE, LOCALE_TAGS, type Locale } from './locales';

export type Params = Readonly<Record<string, string | number>>;
/** Traduz uma chave; `{param}` é substituído. Com `count`, usa `<chave>_one`/`<chave>_other` pela regra de plural do idioma. */
export type T = (key: MessageKey, params?: Params) => string;

export interface Format {
  /** Dólares no formato do idioma (ex.: `US$ 0,41`, `$0.41`, `0,41 $US`). */
  readonly usd: (value: number) => string;
  /** Número com casas decimais fixas no formato do idioma. */
  readonly decimal: (value: number, digits?: number) => string;
  readonly pct: (value: number) => string;
  readonly time: (d: Date) => string;
}

export interface I18n { readonly locale: Locale; readonly t: T; readonly fmt: Format }

const interpolate = (s: string, params?: Params) =>
  params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : s;

export function createI18n(locale: Locale): I18n {
  const table = catalog(locale); const fallback = locale === DEFAULT_LOCALE ? table : catalog(DEFAULT_LOCALE);
  const tag = LOCALE_TAGS[locale]; const plural = new Intl.PluralRules(tag);
  const lookup = (k: string) => table[k] ?? fallback[k];
  const t: T = (key, params) => {
    const count = params?.count;
    if (typeof count === 'number') {
      const form = lookup(`${key}_${plural.select(count)}`) ?? lookup(`${key}_other`);
      if (form !== undefined) return interpolate(form, params);
    }
    return interpolate(lookup(key) ?? key, params);
  };
  const money = new Intl.NumberFormat(tag, { style: 'currency', currency: 'USD', currencyDisplay: locale === 'pt' ? 'symbol' : 'narrowSymbol', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt: Format = {
    usd: (v) => money.format(v).replace(/ /g, ' '),
    decimal: (v, digits = 1) => new Intl.NumberFormat(tag, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false }).format(v),
    pct: (v) => `${Math.round(v)}%`,
    time: (d) => new Intl.DateTimeFormat(tag, { hour: '2-digit', minute: '2-digit' }).format(d),
  };
  return { locale, t, fmt };
}

/** Português: o padrão das funções puras quando ninguém passa idioma (mantém os testes e o comportamento anterior). */
export const PT: I18n = createI18n(DEFAULT_LOCALE);
