import { useI18n } from '../i18n/I18nProvider';
import { Button } from './Button';

interface KillBannerProps { readonly onResume: () => void; readonly busy?: boolean; readonly error?: string | null }

export function KillBanner({ onResume, busy = false, error = null }: KillBannerProps) {
  const { t } = useI18n();
  return (
    <div className="killbanner" role="status">
      <span>
        <span className="killbanner__accent">{t('common.kill.title')}</span> {t('common.kill.body')}
        {error && <><br /><span className="killbanner__accent">{t('common.kill.resumeFailed', { error })}</span></>}
      </span>
      <Button variant="tertiary" disabled={busy} onClick={onResume}>{t(busy ? 'common.kill.resuming' : 'common.kill.resume')}</Button>
    </div>
  );
}
