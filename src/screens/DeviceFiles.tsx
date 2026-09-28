import { useState } from 'react';
import { Button } from '../components/Button';
import { Heading } from '../components/Heading';
import { Notice } from '../components/Notice';
import { useI18n } from '../i18n/I18nProvider';
import { useDaemonError } from '../i18n/useDaemonError';
import type { DeviceFileView, FleetFileView } from '../live/types';
import { fileSize } from './fileSize';
import './Mission.css';

export interface DeviceFilesProps {
  /** Aparelho no adb: sem ele não dá para listar nem receber. */
  readonly online: boolean;
  /** Arquivos guardados no Tapflock (snapshot), mais novos primeiro. */
  readonly stored: readonly FleetFileView[];
  /** Nome da identidade de origem de um arquivo guardado. */
  readonly nameOf: (identityId: string) => string;
  readonly busy: boolean;
  readonly errors: readonly string[];
  readonly onList: () => Promise<readonly DeviceFileView[] | null>;
  readonly onKeep: (devicePath: string) => Promise<boolean>;
  readonly onSendHere: (fileId: string) => void;
  readonly onDelete: (fileId: string, name: string) => void;
}

/** Arquivos entre aparelhos (spec arquivos §Interface): guardar um arquivo deste device e receber os guardados. */
export function DeviceFiles(p: DeviceFilesProps) {
  const i18n = useI18n(); const { t } = i18n;
  const te = useDaemonError();
  const [onDevice, setOnDevice] = useState<readonly DeviceFileView[] | null>(null);
  const load = async () => { const list = await p.onList(); if (list) setOnDevice(list); };
  const keep = async (path: string) => { if (await p.onKeep(path)) await load(); };
  return (
    <div className="card card--white files">
      <div><Heading size="h4">{t('files.panel.title')}</Heading></div>
      <span className="muted-14">{t('files.panel.lede')}</span>
      {!p.online && <Notice tone="warn">{t('files.offline')}</Notice>}

      {p.online && (
        <div className="row-between">
          <Button variant="secondary" disabled={p.busy} onClick={() => void load()}>{t(onDevice ? 'files.device.reload' : 'files.device.load')}</Button>
        </div>
      )}
      {onDevice && onDevice.length === 0 && <span className="muted-14">{t('files.device.empty')}</span>}
      {onDevice && onDevice.length > 0 && (
        <ul className="files__list">
          {onDevice.map((f) => (
            <li key={f.path} className="files__item">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span className="files__name">{f.name}</span>
                <span className="files__meta">{f.path.slice(0, f.path.lastIndexOf('/'))} · {fileSize(f.size, i18n)}</span>
              </div>
              <div className="files__actions">
                <Button variant="secondary" size="sm" disabled={p.busy} onClick={() => void keep(f.path)}>{t('files.device.keep')}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div><Heading size="h4">{t('files.stored.title')}</Heading></div>
      {p.stored.length === 0 ? <span className="muted-14">{t('files.stored.empty')}</span> : (
        <ul className="files__list">
          {p.stored.map((f) => (
            <li key={f.id} className="files__item">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span className="files__name">{f.name}</span>
                <span className="files__meta">
                  {f.label} · {fileSize(f.sizeBytes, i18n)}{f.sourceIdentityId ? ` · ${t('files.stored.from', { name: p.nameOf(f.sourceIdentityId) })}` : ''}
                </span>
              </div>
              <div className="files__actions">
                <Button variant="secondary" size="sm" disabled={p.busy || !p.online} onClick={() => p.onSendHere(f.id)}>{t('files.stored.sendHere')}</Button>
                <Button variant="ghost" size="sm" disabled={p.busy} onClick={() => p.onDelete(f.id, f.name)}>{t('files.stored.delete')}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {p.errors.map((e) => <Notice key={e}>{te(e)}</Notice>)}
    </div>
  );
}
