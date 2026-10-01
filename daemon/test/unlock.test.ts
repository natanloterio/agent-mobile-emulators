import { describe, expect, it } from 'vitest';
import { ensureUnlocked, isValidPin, lockState, setDevicePin } from '../src/device/unlock.js';

function fakeDevice(opts: { pin: string; userLocked?: boolean; keyguard?: boolean; wrongStays?: boolean }) {
  let userLocked = opts.userLocked ?? false; let keyguard = opts.keyguard ?? userLocked; let typed = '';
  const calls: string[] = [];
  const shell = async (_s: string, cmd: readonly string[]) => {
    const k = cmd.join(' '); calls.push(k);
    if (k === 'dumpsys user') return `Users:\n  UserInfo{0:Owner} ${userLocked ? 'RUNNING_LOCKED' : 'RUNNING_UNLOCKED'}`;
    if (k === 'dumpsys window') return `    isKeyguardShowing=${keyguard}\n`;
    if (k.startsWith('input text ')) typed = cmd[2];
    if (k === 'input keyevent KEYCODE_ENTER' && typed === opts.pin) { userLocked = false; keyguard = false; }
    return '';
  };
  return { adb: { shell }, calls };
}
const fast = { sleep: async () => {}, pollTries: 3 };

describe('isValidPin', () => {
  it('só dígitos, 4 a 16', () => {
    expect(isValidPin('1234')).toBe(true); expect(isValidPin('123')).toBe(false);
    expect(isValidPin('12a4')).toBe(false); expect(isValidPin('1'.repeat(17))).toBe(false);
  });
});

describe('ensureUnlocked', () => {
  it('já destravado: não digita nada', async () => {
    const d = fakeDevice({ pin: '1234' });
    expect(await ensureUnlocked(d.adb, 's', '1234', fast)).toBe('already');
    expect(d.calls.some((c) => c.startsWith('input text'))).toBe(false);
  });
  it('armazenamento travado após boot: acorda, pede o teclado, digita o PIN e confirma', async () => {
    const d = fakeDevice({ pin: '1234', userLocked: true });
    expect(await ensureUnlocked(d.adb, 's', '1234', fast)).toBe('unlocked');
    expect(d.calls).toEqual(expect.arrayContaining(['input keyevent KEYCODE_WAKEUP', 'wm dismiss-keyguard', 'input text 1234', 'input keyevent KEYCODE_ENTER']));
    expect(await lockState(d.adb, 's')).toEqual({ userLocked: false, keyguard: false });
  });
  it('só a tela bloqueada (armazenamento já aberto) também destrava', async () => {
    const d = fakeDevice({ pin: '9876', keyguard: true });
    expect(await ensureUnlocked(d.adb, 's', '9876', fast)).toBe('unlocked');
  });
  it('PIN errado: uma tentativa só (não gasta as chances do device) e erro claro', async () => {
    const d = fakeDevice({ pin: '1234', userLocked: true });
    await expect(ensureUnlocked(d.adb, 's', '0000', fast)).rejects.toThrow(/PIN recusado/);
    expect(d.calls.filter((c) => c.startsWith('input text'))).toHaveLength(1);
  });
  it('travado sem PIN registrado: erro que diz o que fazer', async () => {
    const d = fakeDevice({ pin: '1234', userLocked: true });
    await expect(ensureUnlocked(d.adb, 's', null, fast)).rejects.toThrow(/sem PIN registrado/);
  });
  it('PIN inválido nunca vai para o shell', async () => {
    const d = fakeDevice({ pin: '1234', userLocked: true });
    await expect(ensureUnlocked(d.adb, 's', '12;rm', fast)).rejects.toThrow(/PIN inválido/);
    expect(d.calls.some((c) => c.startsWith('input text'))).toBe(false);
  });
});

describe('setDevicePin', () => {
  const dev = (verify: string, set = 'Pin set to 1234') => {
    const calls: string[] = [];
    const shell = async (_s: string, cmd: readonly string[]) => { const k = cmd.join(' '); calls.push(k); return k.startsWith('locksettings verify') ? verify : k.startsWith('locksettings set-pin') ? set : ''; };
    return { adb: { shell }, calls };
  };
  it('clone sem credencial: define o PIN', async () => {
    const d = dev("Old password '1234' didn't match");
    await setDevicePin(d.adb, 's', '1234');
    expect(d.calls).toContain('locksettings set-pin 1234');
  });
  it('clone que herdou esse mesmo PIN da base: não tenta definir de novo (falharia pedindo o PIN antigo)', async () => {
    const d = dev('Lock credential verified successfully');
    await setDevicePin(d.adb, 's', '1234');
    expect(d.calls.some((c) => c.startsWith('locksettings set-pin'))).toBe(false);
  });
});
