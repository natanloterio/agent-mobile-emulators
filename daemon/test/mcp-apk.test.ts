import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureMcpApk } from '../src/base/mcp-apk.js';

const bytes = Buffer.from('apk de mentira');
const apk = { url: 'https://x/app.apk', version: '9', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
const fetchOf = (body: Buffer, counter = { n: 0 }) => async (_u: string, _i: { signal: AbortSignal }) => { counter.n++; return { ok: true, status: 200, body: new Blob([body]).stream() }; };

describe('ensureMcpApk', () => {
  it('baixa, confere o sha256 e reaproveita o arquivo na próxima vez', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'apk-'));
    const calls = { n: 0 };
    const file = await ensureMcpApk(dir, { fetch: fetchOf(bytes, calls) }, apk);
    expect(existsSync(file)).toBe(true);
    await ensureMcpApk(dir, { fetch: fetchOf(bytes, calls) }, apk);
    expect(calls.n).toBe(1);
  });
  it('hash errado: recusa e não deixa arquivo nenhum no lugar', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'apk-'));
    await expect(ensureMcpApk(dir, { fetch: fetchOf(Buffer.from('adulterado')) }, apk)).rejects.toThrow(/não confere/);
    expect(readdirSync(dir)).toEqual([]);
  });
  it('arquivo em cache corrompido é baixado de novo', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'apk-'));
    writeFileSync(path.join(dir, 'android-remote-control-mcp-9-gms-debug.apk'), 'lixo');
    const calls = { n: 0 };
    await ensureMcpApk(dir, { fetch: fetchOf(bytes, calls) }, apk);
    expect(calls.n).toBe(1);
  });
  it('HTTP com erro vira mensagem clara', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'apk-'));
    await expect(ensureMcpApk(dir, { fetch: async () => ({ ok: false, status: 404, body: null }) }, apk)).rejects.toThrow(/HTTP 404/);
  });
  it('progresso só quando a porcentagem muda', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'apk-'));
    const seen: number[] = [];
    await ensureMcpApk(dir, { fetch: fetchOf(bytes), onProgress: (p) => seen.push(p) }, apk);
    expect(seen).toEqual([...new Set(seen)]);
    expect(seen.at(-1)).toBe(100);
  });
  it('conexão travada: aborta depois do tempo sem dados e não deixa arquivo', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'apk-'));
    const stalled = async (_u: string, init: { signal: AbortSignal }) => ({
      ok: true, status: 200,
      body: new ReadableStream<Uint8Array>({ start(c) { init.signal.addEventListener('abort', () => c.error(new Error('aborted'))); } }),
    });
    await expect(ensureMcpApk(dir, { fetch: stalled, idleMs: 30 }, apk)).rejects.toThrow(/parou/);
    expect(readdirSync(dir)).toEqual([]);
  });
});
