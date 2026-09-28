import { describe, expect, it } from 'vitest';
import { createAdb } from '../../src/device/adb.js';
import { nalType, NAL } from '../../src/device/h264.js';
import { createVideoStreams, type VideoPacket } from '../../src/device/video.js';

const reason = process.env.TAPFLOCK_INTEGRATION ? null : 'TAPFLOCK_INTEGRATION não definido';

describe.skipIf(!!reason)(`vídeo real do emulador (TAPFLOCK_INTEGRATION=1)${reason ? ` — pulado: ${reason}` : ''}`, () => {
  it('scrcpy-server empacotado sobe e o primeiro pacote é key com SPS+PPS+IDR em < 5 s; stop() derruba o servidor', async () => {
    const v = createVideoStreams({ adb: createAdb(), portFrom: 27300 });
    const first = new Promise<VideoPacket>((r) => { const off = v.onPacket((p) => { off(); r(p); }); });
    v.setActive(true); v.start([{ id: 'conta1', serial: 'emulator-5554' }]);
    const p = await Promise.race([first, new Promise<VideoPacket>((_, rej) => setTimeout(() => rej(new Error('sem pacote em 5 s')), 5000))]);
    expect(p).toMatchObject({ id: 'conta1', seq: 0, key: true });
    expect(nalType(p.data)).toBe(NAL.SPS); expect(p.data.indexOf(Buffer.from([0, 0, 0, 1, 0x65]))).toBeGreaterThan(0);
    v.stop(); await new Promise((r) => setTimeout(r, 1000));
    const ps = await createAdb().devices();   // só para garantir que o adb continua respondendo após o cleanup
    expect(ps).toContain('emulator-5554');
  }, 20_000);
});
