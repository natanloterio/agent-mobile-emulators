import { describe, expect, it, vi } from 'vitest';
import { AdbError } from '../src/device/adb.js';
import { createScreenCapture, type Frame } from '../src/device/screen.js';

/** Relógio falso: `sleep` resolve na ordem em que foi chamado quando `tick()` roda. */
function clock() {
  const waits: { ms: number; r: () => void }[] = [];
  const sleep = (ms: number) => new Promise<void>((r) => { waits.push({ ms, r }); });
  const tick = async (n = 1) => { for (let i = 0; i < n; i++) { const w = waits.shift(); w?.r(); await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); } };
  return { sleep, tick, waits };
}
const png = (n: number) => Buffer.from([0x89, 0x50, 0x4e, 0x47, n]);

describe('createScreenCapture', () => {
  it('não captura sem active; com active captura, emite e guarda o último por id', async () => {
    const calls: string[] = []; const frames: Frame[] = [];
    const c = clock();
    const cap = createScreenCapture({ adb: { screencap: async (s) => { calls.push(s); return png(calls.length); } }, sleep: c.sleep, intervalMs: 500 });
    cap.onFrame((f) => frames.push(f));
    cap.start([{ id: 'conta1', serial: 'emulator-5554' }]);
    await c.tick(2);
    expect(calls).toEqual([]);
    cap.setActive(true); await c.tick(1);
    expect(calls).toEqual(['emulator-5554']);
    expect(frames[0]).toMatchObject({ id: 'conta1', png: png(1).toString('base64') }); expect(frames[0].at).toMatch(/^\d{4}-/);
    expect(cap.last('conta1')?.png).toBe(png(1).toString('base64')); expect(cap.last('x')).toBeNull();
    expect(c.waits[0]?.ms).toBe(500);
    cap.stop();
  });
  it('falha mantém o último quadro e espera retryMs; duas identidades têm loops independentes', async () => {
    const c = clock(); let fail = false;
    const cap = createScreenCapture({ adb: { screencap: async (s) => { if (s === 'b' && fail) throw new AdbError('device-missing', 'gone'); return png(s === 'a' ? 1 : 2); } }, sleep: c.sleep, intervalMs: 500, retryMs: 5000 });
    cap.setActive(true);
    cap.start([{ id: 'A', serial: 'a' }, { id: 'B', serial: 'b' }]);
    await c.tick(2);
    expect(cap.last('A')?.png).toBe(png(1).toString('base64')); expect(cap.last('B')?.png).toBe(png(2).toString('base64'));
    expect(cap.all().map((f) => f.id).sort()).toEqual(['A', 'B']);
    fail = true; await c.tick(2);
    expect(cap.last('B')?.png).toBe(png(2).toString('base64'));
    const ms = c.waits.map((w) => w.ms).sort();
    expect(ms).toEqual([500, 5000]);
    cap.stop();
  });
  it('stop() encerra os loops; start() de novo substitui a lista', async () => {
    const calls: string[] = []; const c = clock();
    const cap = createScreenCapture({ adb: { screencap: async (s) => { calls.push(s); return png(1); } }, sleep: c.sleep });
    cap.setActive(true); cap.start([{ id: 'A', serial: 'a' }]); await c.tick(1);
    cap.stop(); await c.tick(3);
    const n = calls.length;
    cap.start([{ id: 'B', serial: 'b' }]); await c.tick(1);
    expect(calls.slice(n)).toEqual(['b']); expect(cap.last('A')).toBeNull();
    cap.stop();
  });
  it('descarta captura que resolve depois de stop() (generation obsoleta)', async () => {
    const c = clock(); const frames: Frame[] = [];
    let resolveCap: (b: Buffer) => void = () => {};
    const cap = createScreenCapture({ adb: { screencap: () => new Promise<Buffer>((r) => { resolveCap = r; }) }, sleep: c.sleep });
    cap.onFrame((f) => frames.push(f));
    cap.setActive(true);
    cap.start([{ id: 'A', serial: 'a' }]);
    await new Promise((r) => setImmediate(r));
    cap.stop();
    resolveCap(png(1));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(cap.last('A')).toBeNull();
    expect(frames).toEqual([]);
  });
  it('listener que lança não é confundido com falha de captura; outros listeners seguem recebendo', async () => {
    const c = clock(); const received: Frame[] = [];
    const cap = createScreenCapture({ adb: { screencap: async () => png(1) }, sleep: c.sleep, intervalMs: 500, retryMs: 5000 });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    cap.onFrame(() => { throw new Error('boom'); });
    cap.onFrame((f) => received.push(f));
    cap.setActive(true);
    cap.start([{ id: 'A', serial: 'a' }]);
    await c.tick(1);
    expect(received).toHaveLength(1);
    expect(received[0]?.id).toBe('A');
    expect(c.waits[0]?.ms).toBe(500);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
    cap.stop();
  });
  it('pause(id) para a captura daquela identidade e mantém o último quadro; resume(id) retoma', async () => {
    const calls: string[] = []; const c = clock();
    const cap = createScreenCapture({ adb: { screencap: async (s) => { calls.push(s); return png(1); } }, sleep: c.sleep });
    cap.setActive(true); cap.start([{ id: 'A', serial: 'a' }, { id: 'B', serial: 'b' }]); await c.tick(2);
    cap.pause('A'); const n = calls.length; await c.tick(4);
    expect(calls.slice(n)).not.toContain('a'); expect(calls.slice(n)).toContain('b'); expect(cap.last('A')).not.toBeNull();
    cap.resume('A'); await c.tick(4); expect(calls.slice(n).filter((s) => s === 'a').length).toBeGreaterThan(0);
    cap.stop();
  });
});
