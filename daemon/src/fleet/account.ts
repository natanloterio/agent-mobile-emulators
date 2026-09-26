import type { Adb } from '../device/adb.js';

/**
 * Apaga dados e sessão do app alvo num clone recém-provisionado (spec §4.1: a identidade nasce sem conta de terceiro).
 * App ausente no AVD não é erro: não há sessão a limpar.
 */
export async function clearTargetAccount(adb: Pick<Adb, 'shell'>, serial: string, pkg: string): Promise<'cleared' | 'absent'> {
  const path = await adb.shell(serial, ['pm', 'path', pkg]).catch(() => '');
  if (!path.startsWith('package:')) return 'absent';
  const out = (await adb.shell(serial, ['pm', 'clear', pkg])).trim();
  if (out !== 'Success') throw new Error(`pm clear ${pkg}: ${out || 'sem resposta'}`);
  return 'cleared';
}
