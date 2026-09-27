import { describe, expect, it } from 'vitest';
import { unpackedPath } from '../src/config.js';

describe('unpackedPath: arquivo do vendor lido por processo externo (adb push)', () => {
  it('troca app.asar por app.asar.unpacked (posix e windows)', () => {
    expect(unpackedPath('/opt/Enxame/resources/app.asar/daemon/vendor/scrcpy-server-v4.1')).toBe('/opt/Enxame/resources/app.asar.unpacked/daemon/vendor/scrcpy-server-v4.1');
    expect(unpackedPath('C:\\Enxame\\resources\\app.asar\\daemon\\vendor\\x')).toBe('C:\\Enxame\\resources\\app.asar.unpacked\\daemon\\vendor\\x');
  });
  it('fora do asar não muda', () => {
    expect(unpackedPath('/src/enxame/daemon/vendor/x')).toBe('/src/enxame/daemon/vendor/x');
  });
});
