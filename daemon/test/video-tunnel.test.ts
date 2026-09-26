import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { connectTunnel } from '../src/device/video-tunnel.js';

const immediate = () => new Promise<void>((r) => setImmediate(r));

describe('connectTunnel', () => {
  it('socket que fecha sem dados (adb aceitou antes do servidor subir) é descartado; conecta quando chega o primeiro byte, sem perdê-lo', async () => {
    const dialed: PassThrough[] = [];
    const dial = () => {
      const s = new PassThrough(); dialed.push(s);
      if (dialed.length === 1) setImmediate(() => s.end()); else setImmediate(() => s.write(Buffer.from([0, 0, 0, 1, 0x67])));
      return s;
    };
    const sock = await connectTunnel(27183, { timeoutMs: 1000, sleep: immediate, dial });
    expect(dialed).toHaveLength(2); expect(dialed[0].destroyed).toBe(true);
    const got = await new Promise<Buffer>((r) => { sock.once('data', r); sock.resume(); });
    expect([...got]).toEqual([0, 0, 0, 1, 0x67]);
    sock.destroy();
  });
  it('sem dados até o timeout rejeita e destrói o socket', async () => {
    const dialed: PassThrough[] = [];
    const dial = () => { const s = new PassThrough(); dialed.push(s); return s; };
    await expect(connectTunnel(27183, { timeoutMs: 20, sleep: immediate, dial })).rejects.toThrow(/não enviou dados em 20 ms/);
    expect(dialed.every((s) => s.destroyed)).toBe(true);
  });
});
