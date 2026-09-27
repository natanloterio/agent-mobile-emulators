import type { ReactNode } from 'react';
import type { Meter } from '../lib/resources';
import { HOST } from '../lib/resources';
import { useI18n } from '../i18n/I18nProvider';

interface MetersProps {
  readonly meters: readonly Meter[];
  /** Observação própria do SO, entre os medidores e o teto (ex.: memória unificada no Mac). */
  readonly children?: ReactNode;
}

export function Meters({ meters, children }: MetersProps) {
  const { t } = useI18n();
  return (
    <div className="meters">
      <div className="meters__title">{t('shell.meters.title')}</div>
      {meters.map((m) => (
        <div className="meter" key={m.label}>
          <div className="meter__row"><span>{m.label}</span><span>{m.value}</span></div>
          <div className="meter__track"><div className="meter__fill" style={{ width: m.pct }} /></div>
        </div>
      ))}
      {children}
      <div className="meters__note">{t('shell.meters.ceiling', { cpu: HOST.ceilingByCpu, adb: HOST.ceilingByAdb })}</div>
    </div>
  );
}
