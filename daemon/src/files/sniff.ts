import path from 'node:path';

/** Assinaturas conhecidas (primeiros bytes). O tipo vem do conteúdo; a extensão só desempata ZIP × APK e texto. */
const MAGIC: readonly { readonly at: number; readonly bytes: string; readonly mime: string }[] = [
  { at: 0, bytes: '\xff\xd8\xff', mime: 'image/jpeg' },
  { at: 0, bytes: '\x89PNG\r\n\x1a\n', mime: 'image/png' },
  { at: 0, bytes: 'GIF8', mime: 'image/gif' },
  { at: 8, bytes: 'WEBP', mime: 'image/webp' },
  { at: 4, bytes: 'ftypheic', mime: 'image/heic' },
  { at: 4, bytes: 'ftypheix', mime: 'image/heic' },
  { at: 4, bytes: 'ftypmif1', mime: 'image/heic' },
  { at: 4, bytes: 'ftypavif', mime: 'image/avif' },
  { at: 4, bytes: 'ftypM4A', mime: 'audio/mp4' },
  { at: 4, bytes: 'ftyp3gp', mime: 'video/3gpp' },
  { at: 4, bytes: 'ftypqt', mime: 'video/quicktime' },
  { at: 4, bytes: 'ftyp', mime: 'video/mp4' },
  { at: 0, bytes: '\x1aE\xdf\xa3', mime: 'video/webm' },
  { at: 0, bytes: '%PDF-', mime: 'application/pdf' },
  { at: 0, bytes: 'ID3', mime: 'audio/mpeg' },
  { at: 0, bytes: 'OggS', mime: 'audio/ogg' },
];
/** Bytes que o `sniffMime` precisa ler do começo do arquivo. */
export const SNIFF_BYTES = 16;

const hasAt = (head: Buffer, at: number, sig: string) => head.length >= at + sig.length && head.toString('latin1', at, at + sig.length) === sig;
const looksText = (head: Buffer) => head.length > 0 && head.every((b) => b === 9 || b === 10 || b === 13 || (b >= 32 && b !== 127));

export function sniffMime(head: Buffer, name: string): string {
  const hit = MAGIC.find((m) => hasAt(head, m.at, m.bytes));
  if (hit) return hit.mime;
  const ext = path.extname(name).toLowerCase();
  if (hasAt(head, 0, 'PK\x03\x04')) return ext === '.apk' ? 'application/vnd.android.package-archive' : 'application/zip';
  return looksText(head) ? 'text/plain' : 'application/octet-stream';
}

export type FileKind = 'image' | 'video' | 'other';
export const kindOf = (mime: string): FileKind => (mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : 'other');

const MAX_NAME = 120;

/** Nome seguro para o disco do host e do device: sem diretórios, sem controle/metacaracteres, sem ponto inicial. */
export function safeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  // trim antes de trocar os pontos iniciais: " .." viraria ".." (o diretório pai) se fosse na ordem inversa.
  let name = base.replace(/[^\p{L}\p{N} ._()\-]/gu, '_').trim().replace(/^\.+/, (d) => '_'.repeat(d.length));
  if (!name) return 'arquivo';
  if (name.length > MAX_NAME) {
    const ext = path.extname(name).slice(0, 12);
    name = name.slice(0, MAX_NAME - ext.length) + ext;
  }
  return name;
}

/** Extensões aceitas por tipo (a primeira é a que se acrescenta). O MediaStore classifica pela extensão, não pelos bytes. */
const EXT: Readonly<Record<string, readonly string[]>> = {
  'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'image/gif': ['.gif'], 'image/webp': ['.webp'],
  'image/heic': ['.heic', '.heif'], 'image/avif': ['.avif'], 'video/mp4': ['.mp4', '.m4v'], 'video/quicktime': ['.mov'],
  'video/webm': ['.webm'], 'video/3gpp': ['.3gp'], 'application/pdf': ['.pdf'], 'audio/mpeg': ['.mp3'], 'audio/ogg': ['.ogg', '.oga'],
  'audio/mp4': ['.m4a'], 'application/zip': ['.zip'], 'application/vnd.android.package-archive': ['.apk'],
};

/** Nome com a extensão do tipo detectado (acrescenta quando falta ou não bate); tipos genéricos ficam como vieram. */
export function withExtension(name: string, mime: string): string {
  const exts = EXT[mime];
  if (!exts) return name;
  return exts.includes(path.extname(name).toLowerCase()) ? name : `${name}${exts[0]}`;
}
