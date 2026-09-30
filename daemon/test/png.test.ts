import { deflateSync } from 'node:zlib';
import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { cropPng, parseBounds, readPng } from '../src/files/png.js';

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}
/** PNG RGBA w×h onde o pixel (x,y) = [x, y, 7, 255]; linhas com filtros variados (0..4) como o screencap usa. */
function makePng(w: number, h: number, colorType = 6): Buffer {
  const bpp = colorType === 6 ? 4 : 3;
  const px = (x: number, y: number) => (colorType === 6 ? [x, y, 7, 255] : [x, y, 7]);
  const rows: Buffer[] = []; let prev = Buffer.alloc(w * bpp);
  for (let y = 0; y < h; y++) {
    const raw = Buffer.from(Array.from({ length: w }, (_, x) => px(x, y)).flat());
    const f = y % 5; const out = Buffer.alloc(w * bpp);
    for (let i = 0; i < raw.length; i++) {
      const a = i >= bpp ? raw[i - bpp] : 0; const b = prev[i]; const c = i >= bpp ? prev[i - bpp] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      const pred = [0, a, b, (a + b) >> 1, paeth][f];
      out[i] = (raw[i] - pred) & 0xff;
    }
    rows.push(Buffer.concat([Buffer.from([f]), out])); prev = raw;
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = colorType;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

describe('png', () => {
  it('lê RGBA com todos os filtros', () => {
    const img = readPng(makePng(6, 7));
    expect([img.width, img.height, img.bpp]).toEqual([6, 7, 4]);
    expect([...img.pixels.subarray((3 * 6 + 5) * 4, (3 * 6 + 5) * 4 + 4)]).toEqual([5, 3, 7, 255]);
  });
  it('recorta pelos bounds e o resultado é um PNG válido com os pixels certos', () => {
    const out = readPng(cropPng(makePng(10, 12), { left: 2, top: 3, right: 6, bottom: 8 }));
    expect([out.width, out.height]).toEqual([4, 5]);
    expect([...out.pixels.subarray(0, 4)]).toEqual([2, 3, 7, 255]);
    expect([...out.pixels.subarray(out.pixels.length - 4)]).toEqual([5, 7, 7, 255]);
  });
  it('RGB também; bounds fora da imagem são cortados na borda', () => {
    const out = readPng(cropPng(makePng(5, 5, 2), { left: 3, top: -4, right: 99, bottom: 2 }));
    expect([out.width, out.height, out.bpp]).toEqual([2, 2, 3]);
  });
  it('recusa recorte vazio e PNG que não é do screencap (paleta, 16 bits)', () => {
    expect(() => cropPng(makePng(5, 5), { left: 4, top: 4, right: 4, bottom: 9 })).toThrow(/vazio/);
    expect(() => readPng(Buffer.from('não é png'))).toThrow(/PNG/);
  });
  it('parseBounds aceita o formato da tela ("l,t,r,b") e recusa lixo', () => {
    expect(parseBounds('0,210,1080,1290')).toEqual({ left: 0, top: 210, right: 1080, bottom: 1290 });
    expect(parseBounds(' 1, 2 ,3,4 ')).toEqual({ left: 1, top: 2, right: 3, bottom: 4 });
    expect(parseBounds('1,2,3')).toBeNull();
    expect(parseBounds('a,b,c,d')).toBeNull();
  });
});
