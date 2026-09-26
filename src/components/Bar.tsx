interface BarProps {
  readonly pct: number;
  readonly thin?: boolean;
  readonly track?: 'white' | 'grey';
  readonly fill?: 'dark' | 'green';
}

export function Bar({ pct, thin = false, track = 'white', fill = 'dark' }: BarProps) {
  const cls = ['bar', thin ? 'bar--thin' : '', track === 'grey' ? 'bar--grey' : ''].filter(Boolean).join(' ');
  const fillCls = fill === 'green' ? 'bar__fill bar__fill--green' : 'bar__fill';
  return (
    <div className={cls} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={fillCls} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}
