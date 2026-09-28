import { describe, expect, it } from 'vitest';
import { deviceDirFor, listSharedFiles, mediaScan, normalizeDevicePath, parseStatLines, shq } from '../src/files/device-files.js';
import { kindOf, safeFileName, sniffMime, withExtension } from '../src/files/sniff.js';

describe('caminho no device', () => {
  it('aceita só armazenamento compartilhado e normaliza /storage/emulated/0', () => {
    expect(normalizeDevicePath('/sdcard/Download/a b.pdf')).toBe('/sdcard/Download/a b.pdf');
    expect(normalizeDevicePath('/storage/emulated/0/DCIM/Camera/x.jpg')).toBe('/sdcard/DCIM/Camera/x.jpg');
    expect(normalizeDevicePath('/sdcard/Pictures/Tapflock/y.png')).toBe('/sdcard/Pictures/Tapflock/y.png');
  });
  it('recusa dados de app, travessia, raiz sem arquivo e caracteres de controle', () => {
    for (const p of ['/data/data/com.x/files/a', '/sdcard/Download/../../data/a', '/sdcard/Download', '/sdcard/Download/', '/sdcard/Android/data/x',
      'Download/a', '/sdcard/Download/a\nb', '/sdcard/Download/a\0b', '']) expect(normalizeDevicePath(p)).toBeNull();
  });
  it('shq escapa aspas simples para o sh do device', () => {
    expect(shq("a b'c")).toBe("'a b'\\''c'");
  });
});

describe('listagem', () => {
  it('parseStatLines lê mtime|tamanho|caminho, pula ocultos, pendentes e lixeira', () => {
    const out = [
      '1700000100|2048|/sdcard/Download/rel atorio.pdf',
      '1700000200|10|/sdcard/Download/.pending-1700-x.jpg',
      '1700000300|10|/sdcard/Pictures/.trashed-1-a.jpg',
      '1700000400|99|/sdcard/DCIM/.thumbnails/t.jpg',
      'lixo',
      '1700000500|5|/sdcard/Pictures/a|b.png',
    ].join('\n');
    expect(parseStatLines(out)).toEqual([
      { path: '/sdcard/Download/rel atorio.pdf', name: 'rel atorio.pdf', size: 2048, mtime: 1700000100 },
      { path: '/sdcard/Pictures/a|b.png', name: 'a|b.png', size: 5, mtime: 1700000500 },
    ]);
  });
  it('listSharedFiles roda um find só, filtra por data e devolve o mais novo primeiro', async () => {
    const cmds: string[] = [];
    const adb = { shell: async (_s: string, cmd: readonly string[]) => { cmds.push(cmd.join(' ')); return '100|1|/sdcard/Download/velho.txt\n300|3|/sdcard/Download/novo.txt\n200|2|/sdcard/DCIM/meio.jpg\n'; } };
    const files = await listSharedFiles(adb, 'emulator-5554', { sinceSec: 150, limit: 10 });
    expect(files.map((f) => f.name)).toEqual(['novo.txt', 'meio.jpg']);
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toContain("find '/sdcard/Download' '/sdcard/DCIM' '/sdcard/Pictures' '/sdcard/Movies' '/sdcard/Documents' -type f");
    expect(cmds[0]).toContain("stat -c '%Y|%s|%n'");
  });
  it('excludeImported deixa de fora o que o Tapflock mesmo enviou (pastas Tapflock)', async () => {
    const adb = { shell: async () => '5|1|/sdcard/Pictures/Tapflock/veio.jpg\n3|1|/sdcard/Download/baixado.pdf\n4|1|/sdcard/Download/Tapflock/x.pdf' };
    expect((await listSharedFiles(adb, 's', { limit: 5, excludeImported: true })).map((f) => f.name)).toEqual(['baixado.pdf']);
    expect((await listSharedFiles(adb, 's', { limit: 5 })).map((f) => f.name)).toEqual(['veio.jpg', 'x.pdf', 'baixado.pdf']);
  });
  it('limit corta a lista', async () => {
    const adb = { shell: async () => '1|1|/sdcard/Download/a\n2|1|/sdcard/Download/b\n3|1|/sdcard/Download/c' };
    expect((await listSharedFiles(adb, 's', { limit: 2 })).map((f) => f.name)).toEqual(['c', 'b']);
  });
});

describe('tipo e destino', () => {
  it('sniffMime reconhece pelos bytes, não pela extensão', () => {
    expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'x.txt')).toBe('image/jpeg');
    expect(sniffMime(Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), 'x')).toBe('image/png');
    expect(sniffMime(Buffer.from('%PDF-1.7'), 'a.bin')).toBe('application/pdf');
    expect(sniffMime(Buffer.from('\0\0\0\x18ftypmp42', 'latin1'), 'v')).toBe('video/mp4');
    expect(sniffMime(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1'), 'w')).toBe('image/webp');
    expect(sniffMime(Buffer.from('GIF89a'), 'g')).toBe('image/gif');
    expect(sniffMime(Buffer.from('PK\x03\x04', 'latin1'), 'a.apk')).toBe('application/vnd.android.package-archive');
    expect(sniffMime(Buffer.from('PK\x03\x04', 'latin1'), 'a.zip')).toBe('application/zip');
    expect(sniffMime(Buffer.from('ola'), 'n.txt')).toBe('text/plain');
    expect(sniffMime(Buffer.from([1, 2, 3]), 'n.dat')).toBe('application/octet-stream');
  });
  it('kindOf e deviceDirFor mandam imagem para Pictures, vídeo para Movies e o resto para Download', () => {
    expect(kindOf('image/png')).toBe('image');
    expect(kindOf('video/mp4')).toBe('video');
    expect(kindOf('application/pdf')).toBe('other');
    expect(deviceDirFor('image/jpeg')).toBe('/sdcard/Pictures/Tapflock');
    expect(deviceDirFor('video/mp4')).toBe('/sdcard/Movies/Tapflock');
    expect(deviceDirFor('application/pdf')).toBe('/sdcard/Download/Tapflock');
  });
  it('safeFileName nunca devolve . ou .. (espaço antes dos pontos)', () => {
    expect(safeFileName(' ..')).toBe('__');
    expect(safeFileName(' .')).toBe('_');
    expect(safeFileName('..')).toBe('__');
  });
  it('sniffMime separa HEIF/AVIF/áudio/3gp do mp4 genérico', () => {
    expect(sniffMime(Buffer.from('\0\0\0\x18ftypmif1', 'latin1'), 'x')).toBe('image/heic');
    expect(sniffMime(Buffer.from('\0\0\0\x18ftypheix', 'latin1'), 'x')).toBe('image/heic');
    expect(sniffMime(Buffer.from('\0\0\0\x18ftypavif', 'latin1'), 'x')).toBe('image/avif');
    expect(sniffMime(Buffer.from('\0\0\0\x18ftypM4A ', 'latin1'), 'x')).toBe('audio/mp4');
    expect(sniffMime(Buffer.from('\0\0\0\x18ftyp3gp4', 'latin1'), 'x')).toBe('video/3gpp');
  });
  it('withExtension põe a extensão do tipo quando o nome não tem a certa', () => {
    expect(withExtension('download', 'image/jpeg')).toBe('download.jpg');
    expect(withExtension('x.bin', 'image/png')).toBe('x.bin.png');
    expect(withExtension('a.JPEG', 'image/jpeg')).toBe('a.JPEG');
    expect(withExtension('a.pdf', 'application/pdf')).toBe('a.pdf');
    expect(withExtension('notas', 'application/octet-stream')).toBe('notas');
  });
  it('safeFileName tira diretórios e caracteres estranhos, mantém a extensão e limita o tamanho', () => {
    expect(safeFileName('/sdcard/Download/Relatório final (1).pdf')).toBe('Relatório final (1).pdf');
    expect(safeFileName('../../a;rm -rf.png')).toBe('a_rm -rf.png');
    expect(safeFileName('.oculto')).toBe('_oculto');
    expect(safeFileName('')).toBe('arquivo');
    const long = safeFileName(`${'x'.repeat(300)}.jpeg`);
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long.endsWith('.jpeg')).toBe(true);
  });
});

describe('media scan', () => {
  it('manda o broadcast com URI file:// codificada e entre aspas', async () => {
    const cmds: string[] = [];
    await mediaScan({ shell: async (_s, c) => { cmds.push(c.join(' ')); return ''; } }, 's', "/sdcard/Pictures/Tapflock/a b's.png");
    expect(cmds).toEqual(["am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d 'file:///sdcard/Pictures/Tapflock/a%20b'\\''s.png'"]);
  });
});
