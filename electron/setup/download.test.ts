import { createHash } from 'node:crypto';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { downloadResumable } from './download';

const BODY = Buffer.from('0123456789abcdefghij'); // 20 bytes
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const tmp = () => mkdtemp(path.join(os.tmpdir(), 'enxame-dl-'));

describe('downloadResumable', () => {
  it('baixa, confere o checksum e renomeia o .part', async () => {
    const dir = await tmp(); const dest = path.join(dir, 'f.bin');
    const seen: number[] = [];
    await downloadResumable({
      url: 'https://x.test/f', dest, checksum: { algo: 'sha256', hex: sha256(BODY) },
      fetch: (async () => new Response(BODY, { status: 200, headers: { 'content-length': '20' } })) as unknown as typeof fetch,
      onProgress: (done, total) => { seen.push(done); expect(total).toBe(20); },
    });
    expect(await readFile(dest)).toEqual(BODY);
    expect(seen.at(-1)).toBe(20);
    await expect(stat(`${dest}.part`)).rejects.toThrow();
  });
  it('retoma do .part com Range e soma ao que já tinha', async () => {
    const dir = await tmp(); const dest = path.join(dir, 'f.bin');
    await writeFile(`${dest}.part`, BODY.subarray(0, 8));
    let range: string | null = null;
    await downloadResumable({
      url: 'https://x.test/f', dest, checksum: { algo: 'sha256', hex: sha256(BODY) },
      fetch: (async (_u: unknown, init?: { headers?: Record<string, string> }) => {
        range = init?.headers?.range ?? null;
        return new Response(BODY.subarray(8), { status: 206, headers: { 'content-range': 'bytes 8-19/20' } });
      }) as unknown as typeof fetch,
    });
    expect(range).toBe('bytes=8-');
    expect(await readFile(dest)).toEqual(BODY);
  });
  it('servidor que ignora Range (200) recomeça do zero sem duplicar bytes', async () => {
    const dir = await tmp(); const dest = path.join(dir, 'f.bin');
    await writeFile(`${dest}.part`, Buffer.from('lixo-antigo'));
    await downloadResumable({
      url: 'https://x.test/f', dest, checksum: { algo: 'sha256', hex: sha256(BODY) },
      fetch: (async () => new Response(BODY, { status: 200 })) as unknown as typeof fetch,
    });
    expect(await readFile(dest)).toEqual(BODY);
  });
  it('416 com .part completo: só confere e renomeia', async () => {
    const dir = await tmp(); const dest = path.join(dir, 'f.bin');
    await writeFile(`${dest}.part`, BODY);
    await downloadResumable({
      url: 'https://x.test/f', dest, checksum: { algo: 'sha256', hex: sha256(BODY) },
      fetch: (async () => new Response(null, { status: 416 })) as unknown as typeof fetch,
    });
    expect(await readFile(dest)).toEqual(BODY);
  });
  it('checksum errado: apaga o .part e lança checksum', async () => {
    const dir = await tmp(); const dest = path.join(dir, 'f.bin');
    await expect(downloadResumable({
      url: 'https://x.test/f', dest, checksum: { algo: 'sha1', hex: '0'.repeat(40) },
      fetch: (async () => new Response(BODY, { status: 200 })) as unknown as typeof fetch,
    })).rejects.toMatchObject({ kind: 'checksum' });
    await expect(stat(`${dest}.part`)).rejects.toThrow();
  });
  it('fetch que falha vira network; 404 também', async () => {
    const dir = await tmp(); const dest = path.join(dir, 'f.bin');
    await expect(downloadResumable({ url: 'https://x.test/f', dest, fetch: (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch }))
      .rejects.toMatchObject({ kind: 'network' });
    await expect(downloadResumable({ url: 'https://x.test/f', dest, fetch: (async () => new Response('não', { status: 404 })) as unknown as typeof fetch }))
      .rejects.toMatchObject({ kind: 'network' });
  });
});
