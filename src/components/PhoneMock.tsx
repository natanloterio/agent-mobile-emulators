import './PhoneMock.css';

interface Row { readonly a: string; readonly b: string }
const TILE_ROWS: readonly Row[] = [{ a: '80%', b: '55%' }, { a: '70%', b: '40%' }];
const FULL_ROWS: readonly Row[] = [{ a: '70%', b: '45%' }, { a: '85%', b: '30%' }, { a: '60%', b: '50%' }, { a: '75%', b: '35%' }];

interface PhoneMockProps {
  readonly handle: string;
  readonly streamLabel: string;
  readonly variant: 'tile' | 'full';
  readonly overlay?: string;
  readonly draft?: string;
  readonly controlled?: boolean;
  readonly maxHeight?: string;
}

/** Esqueleto de tela de celular: onde entra o stream do scrcpy quando o daemon existir. */
export function PhoneMock({ handle, streamLabel, variant, overlay, draft, controlled = false, maxHeight }: PhoneMockProps) {
  const rows = variant === 'tile' ? TILE_ROWS : FULL_ROWS;
  const cls = ['phone', `phone--${variant}`, controlled ? 'phone--controlled' : ''].filter(Boolean).join(' ');
  return (
    <div className={cls} style={maxHeight ? { maxHeight } : undefined}>
      <div className="phone__meta"><span>{handle}</span><span>{streamLabel}</span></div>
      <div className="phone__block phone__block--top" />
      {rows.slice(0, variant === 'tile' ? 1 : rows.length).map((r, i) => (
        <div className="phone__row" key={i}>
          <div className="phone__avatar" />
          <div className="phone__lines">
            <div className="phone__line" style={{ width: r.a }} />
            <div className="phone__line" style={{ width: r.b }} />
          </div>
        </div>
      ))}
      <div className="phone__block phone__block--fill" />
      {variant === 'tile' && (
        <div className="phone__row">
          <div className="phone__avatar" />
          <div className="phone__lines">
            <div className="phone__line" style={{ width: '70%' }} />
            <div className="phone__line" style={{ width: '40%' }} />
          </div>
        </div>
      )}
      {variant === 'full' && draft && <div className="phone__draft">{draft}</div>}
      {overlay && <div className="phone__overlay">{overlay}</div>}
    </div>
  );
}
