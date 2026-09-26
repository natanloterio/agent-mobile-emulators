import { Button } from './Button';

interface KillBannerProps { readonly onResume: () => void }

export function KillBanner({ onResume }: KillBannerProps) {
  return (
    <div className="killbanner" role="status">
      <span>
        <span className="killbanner__accent">Kill switch acionado.</span> Frota parada; devices preservados como estão
        para inspeção, sem reverter snapshot.
      </span>
      <Button variant="tertiary" onClick={onResume}>Retomar frota</Button>
    </div>
  );
}
