import type { I18n } from '../i18n/translate';

/** Tamanho legível (KB até 1 MB, MB até 1 GB, GB depois) no formato decimal do idioma. */
export function fileSize(bytes: number, { fmt }: Pick<I18n, 'fmt'>): string {
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`;
  const mb = kb / 1024;
  return mb < 1024 ? `${fmt.decimal(mb, 1)} MB` : `${fmt.decimal(mb / 1024, 1)} GB`;
}
