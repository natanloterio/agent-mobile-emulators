import type { Meter } from '../lib/resources';
import { HOST } from '../lib/resources';

interface MetersProps { readonly meters: readonly Meter[] }

export function Meters({ meters }: MetersProps) {
  return (
    <div className="meters">
      <div className="meters__title">Recursos do host</div>
      {meters.map((m) => (
        <div className="meter" key={m.label}>
          <div className="meter__row"><span>{m.label}</span><span>{m.value}</span></div>
          <div className="meter__track"><div className="meter__fill" style={{ width: m.pct }} /></div>
        </div>
      ))}
      <div className="meters__note">Teto: {HOST.ceilingByCpu} por CPU · {HOST.ceilingByAdb} pelo adb</div>
    </div>
  );
}
