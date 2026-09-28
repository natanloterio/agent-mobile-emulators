import { useI18n } from '../i18n/I18nProvider';
import { useDaemonError } from '../i18n/useDaemonError';
import type { DaemonStatus } from '../live/types';
import { Button } from './Button';

type Failed = Extract<DaemonStatus, { state: 'failed' }>;

/** Daemon não subiu: diz o motivo, onde ver detalhes e deixa tentar de novo (antes a tela ficava em "Conectando…"). */
export function DaemonBanner({ status, retrying, onRetry }: { readonly status: Failed; readonly retrying: boolean; readonly onRetry: () => void }) {
  const { t } = useI18n();
  const te = useDaemonError();
  const reason = status.reason === 'exited' ? t('common.daemon.failed.exited', { code: String(status.exitCode ?? '?') })
    : status.reason === 'timeout' ? t('common.daemon.failed.timeout')
    : status.reason === 'stopped' ? t('common.daemon.failed.stopped')
    : t('common.daemon.failed.other', { detail: te(status.detail) });
  return (
    <div className="killbanner" role="alert">
      <span>
        <span className="killbanner__accent">{t('common.daemon.failed.title')}</span> {reason}
        <br />{status.logPath ? t('common.daemon.failed.log', { path: status.logPath }) : t('common.daemon.failed.devLog')}
      </span>
      <Button variant="tertiary" disabled={retrying} onClick={onRetry}>{t(retrying ? 'common.daemon.retrying' : 'common.daemon.retry')}</Button>
    </div>
  );
}
