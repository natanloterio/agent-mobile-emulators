import type { Adb } from './adb.js';

/** Emulador aberto com este AVD (inclusive por fora do Tapflock): pergunta o nome ao console de cada um. */
export async function findRunningAvd(adb: Pick<Adb, 'emu'>, devices: readonly string[], avd: string): Promise<{ serial: string } | undefined> {
  for (const serial of devices.filter((d) => d.startsWith('emulator-'))) {
    const name = await adb.emu(serial, ['avd', 'name']).then((o) => o.split(/\r?\n/)[0].trim()).catch(() => '');
    if (name === avd) return { serial };
  }
  return undefined;
}
