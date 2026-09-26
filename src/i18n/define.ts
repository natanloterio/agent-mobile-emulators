import type { Locale } from './locales';

/** Dicionário plano de um namespace: chave → texto com `{param}`. Plural: chaves `x_one` / `x_other`. */
export type Dict = Readonly<Record<string, string>>;

/**
 * Um namespace com os seis idiomas. Os outros idiomas precisam ter exatamente as chaves do português
 * (faltar ou sobrar chave é erro de compilação).
 */
export function defineMessages<const P extends Dict>(
  pt: P,
  others: { readonly [L in Exclude<Locale, 'pt'>]: { readonly [K in keyof P]: string } },
): { readonly [L in Locale]: { readonly [K in keyof P]: string } } {
  return { pt, ...others };
}
