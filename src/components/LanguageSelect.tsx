import { useI18n } from '../i18n/I18nProvider';
import { LOCALE_NAMES, LOCALES, isLocale } from '../i18n/locales';

/** Seletor de idioma: cada opção no próprio idioma, para quem não lê o atual achar o seu. */
export function LanguageSelect({ compact = false }: { readonly compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className={`langselect${compact ? ' langselect--compact' : ''}`}>
      {!compact && <span className="langselect__label">{t('shell.language.label')}</span>}
      <select className="langselect__select" value={locale} aria-label={t('shell.language.label')}
        onChange={(e) => { if (isLocale(e.target.value)) setLocale(e.target.value); }}>
        {LOCALES.map((l) => <option key={l} value={l}>{compact ? l.toUpperCase() : LOCALE_NAMES[l]}</option>)}
      </select>
    </label>
  );
}
