import { describe, expect, it } from 'vitest';
import { createAdb } from '../../src/device/adb.js';
import { createDeviceInput, parseWmSize, quoteSh } from '../../src/device/input.js';

const reason = process.env.ENXAME_INTEGRATION ? null : 'ENXAME_INTEGRATION não definido';
const SERIAL = 'emulator-5554';

describe.skipIf(!!reason)(`input real no emulador (ENXAME_INTEGRATION=1)${reason ? ` — pulado: ${reason}` : ''}`, () => {
  it('wm size é legível e o escape do sh preserva o texto byte a byte', async () => {
    const adb = createAdb();
    expect(parseWmSize(await adb.shell(SERIAL, ['wm', 'size']))).not.toBeNull();
    const raw = `it's a%s $HOME "q" ; & | \\ \` ( ) * ? ~ !`;
    expect(await adb.shell(SERIAL, ['printf', '%s', quoteSh(raw)])).toBe(raw);
  });
  it('tecla home e toque aceitos pelo device; termina na home', async () => {
    const input = createDeviceInput(createAdb());
    await input.send(SERIAL, { kind: 'key', key: 'home' });
    await input.send(SERIAL, { kind: 'swipe', x: 0.5, y: 0.3, x2: 0.5, y2: 0.35, durationMs: 100 });
    await input.send(SERIAL, { kind: 'key', key: 'home' });
  }, 20_000);
});
