import { crc32, deflateSync, inflateSync } from 'node:zlib';

/**
 * PNG mínimo para recortar o `screencap -p` do Android (8 bits, RGB ou RGBA, sem entrelaçamento), sem biblioteca de
 * imagem: a tool screen_capture recorta a captura pelo bounds de um nó (ex.: o post) antes de mandar para a galeria.
 */
export interface Png { readonly width: number; readonly height: number; readonly bpp: 3 | 4; readonly colorType: 2 | 6; readonly pixels: Buffer }
export interface Bounds { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function readPng(buf: Buffer): Png {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('não é um PNG');
  let off = 8; let width = 0; let height = 0; let colorType = 0; const idat: Buffer[] = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9];
      const depth = data[8]; const interlace = data[12];
      if (depth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) throw new Error('PNG fora do formato do screencap (8 bits RGB/RGBA sem entrelaçamento)');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!width || !height || !idat.length) throw new Error('PNG incompleto');
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0; const b = prev ? prev[i] : 0; const c = prev && i >= bpp ? prev[i - bpp] : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else if (filter !== 0) throw new Error(`filtro PNG desconhecido: ${filter}`);
      cur[i] = (line[i] + pred) & 0xff;
    }
  }
  return { width, height, bpp, colorType: colorType as 2 | 6, pixels };
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

export function writePng(img: Png): Buffer {
  const stride = img.width * img.bpp;
  const raw = Buffer.alloc((stride + 1) * img.height);
  for (let y = 0; y < img.height; y++) img.pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0); ihdr.writeUInt32BE(img.height, 4); ihdr[8] = 8; ihdr[9] = img.colorType;
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Recorta pelos bounds da tela (right/bottom exclusivos), cortando o que passa da borda. */
export function cropPng(buf: Buffer, b: Bounds): Buffer {
  const img = readPng(buf);
  const left = Math.max(0, Math.floor(b.left)); const top = Math.max(0, Math.floor(b.top));
  const right = Math.min(img.width, Math.ceil(b.right)); const bottom = Math.min(img.height, Math.ceil(b.bottom));
  if (right <= left || bottom <= top) throw new Error('recorte vazio: os bounds não cobrem a tela');
  const w = right - left; const h = bottom - top; const stride = img.width * img.bpp;
  const pixels = Buffer.alloc(w * h * img.bpp);
  for (let y = 0; y < h; y++) img.pixels.copy(pixels, y * w * img.bpp, (top + y) * stride + left * img.bpp, (top + y) * stride + right * img.bpp);
  return writePng({ ...img, width: w, height: h, pixels });
}

/** Bounds no formato da tela lida pelo modelo ("left,top,right,bottom"); null se não for isso. */
export function parseBounds(s: string): Bounds | null {
  const parts = s.split(',').map((p) => p.trim());
  if (parts.length !== 4 || parts.some((p) => !/^-?\d+$/.test(p))) return null;
  const [left, top, right, bottom] = parts.map(Number) as [number, number, number, number];
  return { left, top, right, bottom };
}
