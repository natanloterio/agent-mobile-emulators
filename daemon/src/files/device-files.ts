import type { Adb } from '../device/adb.js';
import { kindOf } from './sniff.js';

/**
 * Pastas do armazenamento compartilhado que o `adb` alcança sem root. Dados privados de app (`/data/data`,
 * `/sdcard/Android/data`) ficam de fora: as imagens Google Play não deixam `adb root`.
 */
export const SHARED_ROOTS = ['/sdcard/Download', '/sdcard/DCIM', '/sdcard/Pictures', '/sdcard/Movies', '/sdcard/Documents'] as const;

export interface DeviceFile { readonly path: string; readonly name: string; readonly size: number; readonly mtime: number }

/** Aspas simples para o `sh` do device (`adb shell` junta os argumentos e o device interpreta). */
export const shq = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`;

/** Caminho dentro de uma pasta compartilhada, sem `..` e sem caracteres de controle; senão null. */
export function normalizeDevicePath(raw: string): string | null {
  if (!raw || /[\0-\x1f\x7f]/.test(raw)) return null;
  const p = raw.replace(/^\/storage\/emulated\/0(?=\/)/, '/sdcard');
  const parts = p.split('/');
  if (parts.some((s, i) => (i > 0 && s === '') || s === '.' || s === '..')) return null;
  const root = SHARED_ROOTS.find((r) => p.startsWith(`${r}/`));
  return root && p.length > root.length + 1 ? p : null;
}

/** Lixo que o Android cria e some sozinho (MediaStore pendente/lixeira) e qualquer coisa oculta. */
const HIDDEN = /(^|\/)\./;

export function parseStatLines(out: string): readonly DeviceFile[] {
  const files: DeviceFile[] = [];
  for (const line of out.replace(/\r/g, '').split('\n')) {
    const m = /^(\d+)\|(\d+)\|(\/.+)$/.exec(line);
    if (!m) continue;
    const p = m[3];
    if (HIDDEN.test(p.slice(1)) || !normalizeDevicePath(p)) continue;
    files.push({ path: p, name: p.slice(p.lastIndexOf('/') + 1), size: Number(m[2]), mtime: Number(m[1]) });
  }
  return files;
}

type ShellAdb = Pick<Adb, 'shell'>;

/** Pastas onde o próprio Tapflock deixa o que envia (`deviceDirFor`). */
const IMPORTED = /\/Tapflock\//;

/**
 * Arquivos das pastas compartilhadas, mais novo primeiro; `sinceSec` = só os modificados a partir desse instante (epoch).
 * `excludeImported` deixa de fora o que o Tapflock enviou: o `adb push` carimba a hora do envio, e um arquivo recebido
 * passaria por "baixado agora" e voltaria para a etapa seguinte.
 */
export async function listSharedFiles(adb: ShellAdb, serial: string, o: { sinceSec?: number; limit: number; excludeImported?: boolean }): Promise<readonly DeviceFile[]> {
  const roots = SHARED_ROOTS.map(shq).join(' ');
  const out = await adb.shell(serial, [`find ${roots} -type f -exec stat -c '%Y|%s|%n' {} + 2>/dev/null; true`]);
  return parseStatLines(out)
    .filter((f) => (o.sinceSec === undefined || f.mtime >= o.sinceSec) && !(o.excludeImported && IMPORTED.test(f.path)))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, o.limit);
}

/** Tamanho de um arquivo comum no device; null se não existe ou não é arquivo (pasta puxaria a árvore inteira). */
export async function statFileSize(adb: ShellAdb, serial: string, devicePath: string): Promise<number | null> {
  const out = (await adb.shell(serial, [`stat -c '%F|%s' ${shq(devicePath)} 2>/dev/null; true`])).trim();
  const m = /^(regular (?:empty )?file)\|(\d+)$/.exec(out);
  return m ? Number(m[2]) : null;
}

export async function existsOnDevice(adb: ShellAdb, serial: string, devicePath: string): Promise<boolean> {
  return (await adb.shell(serial, [`test -e ${shq(devicePath)} && echo sim; true`])).trim() === 'sim';
}

/** Pasta de destino por tipo: imagem na galeria, vídeo em Filmes, o resto em Download. */
export function deviceDirFor(mime: string): string {
  const k = kindOf(mime);
  return k === 'image' ? '/sdcard/Pictures/Tapflock' : k === 'video' ? '/sdcard/Movies/Tapflock' : '/sdcard/Download/Tapflock';
}

/** Avisa o MediaStore do arquivo novo: sem isso, galeria e seletores de mídia dos apps não o enxergam. */
export async function mediaScan(adb: ShellAdb, serial: string, devicePath: string): Promise<void> {
  await adb.shell(serial, [`am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d ${shq(`file://${encodeURI(devicePath)}`)}`]);
}
