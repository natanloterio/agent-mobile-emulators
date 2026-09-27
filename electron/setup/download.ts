import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { SetupError, toSetupError } from './errors.js';

export interface Checksum { readonly algo: 'sha1' | 'sha256'; readonly hex: string }
export interface DownloadOpts {
  readonly url: string; readonly dest: string;
  readonly checksum?: Checksum | null;
  readonly onProgress?: (doneBytes: number, totalBytes: number | null) => void;
  readonly fetch?: typeof fetch;
}

const sizeOf = (p: string) => stat(p).then((s) => s.size, () => 0);
const hostOf = (url: string) => new URL(url).host;

/** `bytes 8-19/20` → 20. */
function totalFromRange(h: string | null): number | null {
  const m = /\/(\d+)$/.exec(h ?? '');
  return m ? Number(m[1]) : null;
}

async function hashFile(file: string, algo: Checksum['algo']): Promise<string> {
  const h = createHash(algo);
  await pipeline(createReadStream(file), h);
  return h.digest('hex');
}

/**
 * Baixa para `<dest>.part` e renomeia no fim. Com `.part` existente pede `Range` e continua (spec: "o download
 * continua de onde parou"); servidor que responde 200 recomeça do zero; 416 = já estava completo.
 */
export async function downloadResumable(o: DownloadOpts): Promise<void> {
  const fetchFn = o.fetch ?? fetch;
  const part = `${o.dest}.part`;
  await mkdir(path.dirname(o.dest), { recursive: true });
  const have = await sizeOf(part);
  let res: Response;
  try {
    res = await fetchFn(o.url, { headers: have > 0 ? { range: `bytes=${have}-` } : {} });
  } catch (e) {
    throw new SetupError('network', `sem conexão com ${hostOf(o.url)}`, { cause: e });
  }
  if (res.status !== 416) {
    if (!res.ok || !res.body) throw new SetupError('network', `${hostOf(o.url)} respondeu ${res.status}`);
    const append = res.status === 206;
    const start = append ? have : 0;
    const total = append ? totalFromRange(res.headers.get('content-range')) : Number(res.headers.get('content-length')) || null;
    let done = start;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) { done += chunk.length; o.onProgress?.(done, total); cb(null, chunk); },
    });
    try {
      await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), counter, createWriteStream(part, { flags: append ? 'a' : 'w' }));
    } catch (e) {
      throw toSetupError(e);
    }
  }
  if (o.checksum) {
    const got = await hashFile(part, o.checksum.algo);
    if (got !== o.checksum.hex.toLowerCase()) {
      await unlink(part).catch(() => undefined);
      throw new SetupError('checksum', `o arquivo de ${hostOf(o.url)} veio diferente do esperado`);
    }
  }
  await rename(part, o.dest);
}
