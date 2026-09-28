import { describe, expect, it } from 'vitest';
import { findRunningAvd } from '../src/device/running-avd.js';

describe('findRunningAvd', () => {
  it('acha o emulador pelo nome do AVD no console; ignora quem não é emulador ou não responde', async () => {
    const names: Record<string, string> = { 'emulator-5554': 'outro\r\nOK', 'emulator-5556': 'tapflock_golden\nOK' };
    const adb = { emu: async (serial: string) => { if (!(serial in names)) throw new Error('offline'); return names[serial]; } };
    expect(await findRunningAvd(adb, ['R58M', 'emulator-5554', 'emulator-5558', 'emulator-5556'], 'tapflock_golden')).toEqual({ serial: 'emulator-5556' });
    expect(await findRunningAvd(adb, ['emulator-5554'], 'tapflock_golden')).toBeUndefined();
  });
});
