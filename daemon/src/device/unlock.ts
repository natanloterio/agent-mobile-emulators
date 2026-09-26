import type { Adb } from './adb.js';

type ShellAdb = Pick<Adb, 'shell'>;
export interface UnlockDeps { readonly sleep?: (ms: number) => Promise<void>; readonly pollTries?: number }
export interface LockState { readonly userLocked: boolean; readonly keyguard: boolean }

const PIN = /^\d{4,16}$/;
/** PIN do Android: só dígitos, 4 a 16. Validado antes de chegar ao shell do device. */
export const isValidPin = (pin: string): boolean => PIN.test(pin);

/**
 * `userLocked`: armazenamento criptografado do usuário fechado (Direct Boot, após reboot com credencial).
 * `keyguard`: tela de bloqueio visível. Qualquer um dos dois impede o worker de operar o app.
 */
export async function lockState(adb: ShellAdb, serial: string): Promise<LockState> {
  const [user, win] = await Promise.all([
    adb.shell(serial, ['dumpsys', 'user']).catch(() => ''),
    adb.shell(serial, ['dumpsys', 'window']).catch(() => ''),
  ]);
  return { userLocked: /RUNNING_LOCKED/.test(user), keyguard: /isKeyguardShowing=true/.test(win) };
}

/**
 * Destrava com o PIN da identidade (medido no Android 14 do emulador: acordar, `wm dismiss-keyguard`, digitar, Enter).
 * Uma tentativa por chamada: PIN errado repetido faz o Android bloquear por tempo e depois exigir ação humana.
 */
export async function ensureUnlocked(adb: ShellAdb, serial: string, pin: string | null | undefined, deps: UnlockDeps = {}): Promise<'already' | 'unlocked'> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const locked = (s: LockState) => s.userLocked || s.keyguard;
  if (!locked(await lockState(adb, serial))) return 'already';
  if (!pin) throw new Error('device bloqueado e identidade sem PIN registrado: registre o PIN da identidade');
  if (!isValidPin(pin)) throw new Error('PIN inválido registrado na identidade (só dígitos, 4 a 16)');
  await adb.shell(serial, ['input', 'keyevent', 'KEYCODE_WAKEUP']);
  await adb.shell(serial, ['wm', 'dismiss-keyguard']);
  await sleep(1200);
  await adb.shell(serial, ['input', 'text', pin]);
  await adb.shell(serial, ['input', 'keyevent', 'KEYCODE_ENTER']);
  for (let k = 0; k < (deps.pollTries ?? 10); k++) {
    await sleep(1000);
    if (!locked(await lockState(adb, serial))) return 'unlocked';
  }
  throw new Error('PIN recusado ou teclado de desbloqueio não apareceu: confira o PIN registrado da identidade');
}

/** Define o PIN no device (clone recém-provisionado, que herda a base sem credencial). */
export async function setDevicePin(adb: ShellAdb, serial: string, pin: string): Promise<void> {
  if (!isValidPin(pin)) throw new Error('PIN inválido (só dígitos, 4 a 16)');
  const out = await adb.shell(serial, ['locksettings', 'set-pin', pin]);
  if (!/Pin set/i.test(out)) throw new Error(`locksettings set-pin: ${out.trim() || 'sem resposta'}`);
}
