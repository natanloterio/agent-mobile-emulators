import { createI18n } from '../i18n/translate';
import type { Locale } from '../i18n/locales';
import type { DeviceFileView } from '../live/types';
import { track, type ApiDeps } from './apiRequest';
import { documentLocale } from './goalActions';

/** Requisições de arquivo de uma identidade (listar/guardar/receber) e de um arquivo (enviar/apagar). */
export const filesKey = (identityId: string): string => `files:${identityId}`;

export interface FileActions {
  /** Arquivos das pastas compartilhadas do device; null = falhou (erro no estado sob `filesKey`). */
  readonly listDevice: (identityId: string) => Promise<readonly DeviceFileView[] | null>;
  /** Guarda um arquivo do device no Tapflock. */
  readonly exportFile: (identityId: string, devicePath: string) => Promise<boolean>;
  /** Copia um arquivo guardado para os devices; true só se chegou em todos. */
  readonly send: (fileId: string, identityIds: readonly string[], key: string) => Promise<boolean>;
  readonly remove: (fileId: string, name: string, key: string) => Promise<boolean>;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

/** Lista vinda do daemon; entradas malformadas ficam de fora. */
export function parseDeviceFiles(x: unknown): readonly DeviceFileView[] {
  const list = isObj(x) && Array.isArray(x.files) ? x.files.filter(isObj) : [];
  return list
    .filter((f) => typeof f.path === 'string' && typeof f.name === 'string')
    .map((f) => ({ path: String(f.path), name: String(f.name), size: Number(f.size) || 0, mtime: Number(f.mtime) || 0 }));
}

/** Arquivos entre aparelhos no modo vivo (spec arquivos §Interface). */
export function createFileActions(deps: ApiDeps & { readonly confirm: (m: string) => boolean; readonly getLocale?: () => Locale }): FileActions {
  const t = () => createI18n((deps.getLocale ?? documentLocale)()).t;
  return {
    listDevice: async (identityId) => {
      const r = await track(deps, filesKey(identityId), (b) => b.api?.('GET', `/files/device/${encodeURIComponent(identityId)}`));
      return r.ok ? parseDeviceFiles(r.value) : null;
    },
    exportFile: async (identityId, devicePath) => {
      const r = await track(deps, filesKey(identityId), (b) => b.api?.('POST', '/files/export', { identityId, devicePath }));
      return r.ok;
    },
    send: async (fileId, identityIds, key) => {
      const r = await track(deps, key, (b) => b.api?.('POST', `/files/${encodeURIComponent(fileId)}/send`, { identityIds }));
      if (!r.ok) return false;
      const failed = isObj(r.value) && Array.isArray(r.value.failed) ? r.value.failed.filter(isObj) : [];
      if (failed.length === 0) return true;
      deps.dispatch({ type: 'requestError', key, message: t()('files.sendFailed', { failed: failed.map((f) => `${String(f.identityId)} (${String(f.error)})`).join(', ') }) });
      return false;
    },
    remove: async (fileId, name, key) => {
      if (!deps.confirm(t()('files.confirmDelete', { name }))) return false;
      const r = await track(deps, key, (b) => b.api?.('POST', `/files/${encodeURIComponent(fileId)}/delete`));
      return r.ok;
    },
  };
}
