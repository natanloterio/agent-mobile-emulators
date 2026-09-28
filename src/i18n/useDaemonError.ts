import { useCallback } from 'react';
import { daemonErrorText } from './daemonErrors';
import { useI18n } from './I18nProvider';

/** Texto de erro vindo do daemon, no idioma da tela (src/i18n/daemonErrors.ts). */
export function useDaemonError(): (raw: string) => string {
  const { t } = useI18n();
  return useCallback((raw: string) => daemonErrorText(raw, t), [t]);
}
