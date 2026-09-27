import { useI18n } from '../../i18n/I18nProvider';
import type { Meter } from '../../lib/resources';
import { Meters } from '../Meters';

interface MacResourcesProps {
  readonly meters: readonly Meter[];
  readonly appleSilicon: boolean;
}

/** macOS: RAM e CPU pelo `os` do Node, sem VRAM. No Apple Silicon a GPU usa a mesma RAM, e a nota diz isso. */
export function MacResources({ meters, appleSilicon }: MacResourcesProps) {
  const { t } = useI18n();
  return (
    <Meters meters={meters}>
      {appleSilicon && <div className="meters__note">{t('shell.meters.unifiedNote')}</div>}
    </Meters>
  );
}
