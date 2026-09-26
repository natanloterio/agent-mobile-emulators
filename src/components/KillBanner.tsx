import { Button } from './Button';

interface KillBannerProps { readonly onResume: () => void; readonly busy?: boolean; readonly error?: string | null }

export function KillBanner({ onResume, busy = false, error = null }: KillBannerProps) {
  return (
    <div className="killbanner" role="status">
      <span>
        <span className="killbanner__accent">Kill switch acionado.</span> Frota parada; devices preservados como estão
        para inspeção, sem reverter snapshot.
        {error && <><br /><span className="killbanner__accent">Retomar falhou: {error}</span></>}
      </span>
      <Button variant="tertiary" disabled={busy} onClick={onResume}>{busy ? 'Retomando…' : 'Retomar frota'}</Button>
    </div>
  );
}
