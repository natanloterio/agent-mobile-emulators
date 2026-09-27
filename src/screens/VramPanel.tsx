import { Heading } from '../components/Heading';
import { useI18n } from '../i18n/I18nProvider';
import type { GpuBarView, GpuSegment } from '../lib/gpuBar';

interface VramPanelProps {
  /** Ocupação medida da GPU (vivo); null cai no quadro estimado do design. */
  readonly gpu: GpuBarView | null;
  readonly fleetSize: number;
  readonly kvLeft: string;
  readonly vramEmuShare: string;
  readonly vramTotal: string;
}

/** Marcador que não aparece em texto: separa o valor em negrito do resto da frase traduzida. */
const SLOT = '\u0000';

/** Cor por tipo (e tom por modelo), usada na barra e na amostra da legenda. */
const colorClass = (s: GpuSegment) => `vram__c--${s.kind}${s.kind === 'model' ? ` vram__c--tone${s.tone}` : ''}`;

/** Quadro da VRAM em Provedores: real (fatias medidas + legenda) ou estimado; o piso de qualidade fica embaixo nos dois. */
export function VramPanel({ gpu, fleetSize, kvLeft, vramEmuShare, vramTotal }: VramPanelProps) {
  const { t } = useI18n();
  const floor = <span className="vram__floor">{t('providers.vram.floor')}</span>;
  if (gpu) {
    const [freeBefore, freeAfter = ''] = t('providers.vram.liveFree', { gb: SLOT }).split(SLOT);
    return (
      <div className="card card--grey vram">
        <div className="row-between vram__head">
          <Heading size="h4" variant="black">{t('providers.vram.liveTitle', { total: gpu.total })}</Heading>
          <span className="muted-15">{freeBefore}<b>{gpu.free}</b>{freeAfter}</span>
        </div>
        <div className="vram__stack" role="img" aria-label={t('providers.vram.aria')}>
          {gpu.segments.filter((s) => Number.parseFloat(s.width) > 0).map((s) => (
            <div key={s.key} className={`vram__seg ${colorClass(s)}`} style={{ width: s.width }} title={`${s.label} · ${s.gb} GB`}>
              {s.inBar && s.kind !== 'free' && <span className="vram__seg-text">{s.label}</span>}
            </div>
          ))}
        </div>
        <ul className="vram__legend" aria-label={t('providers.vram.legend')}>
          {gpu.segments.map((s) => (
            <li key={s.key} className="vram__item">
              <span className={`vram__swatch ${colorClass(s)}`} aria-hidden="true" />
              <span className="vram__item-label">{s.label}</span>
              <b className="vram__item-gb">{s.gb} GB</b>
            </li>
          ))}
        </ul>
        {floor}
      </div>
    );
  }
  const [kvBefore, kvAfter = ''] = t('providers.vram.kvLeft', { kv: SLOT, n: fleetSize }).split(SLOT);
  return (
    <div className="card card--grey vram">
      <div className="row-between">
        <Heading size="h4" variant="black">{t('providers.vram.title', { total: vramTotal })}</Heading>
        <span className="muted-15">{kvBefore}<b>{kvLeft}</b>{kvAfter}</span>
      </div>
      <div className="vram__stack" aria-label={t('providers.vram.aria')}>
        <div className="vram__seg vram__seg--emu" style={{ width: vramEmuShare }}>{t('providers.vram.emu')}</div>
        <div className="vram__seg vram__seg--weights" style={{ width: '59%' }}>{t('providers.vram.weights')}</div>
        <div className="vram__seg vram__seg--kv">KV</div>
      </div>
      {floor}
    </div>
  );
}
