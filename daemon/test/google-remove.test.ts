import { describe, expect, it } from 'vitest';
import { removeGoogleAccount } from '../src/base/google-remove.js';

const node = (text: string, id: string, b: string) => `<node text="${text}" resource-id="${id}" class="c" content-desc="" bounds="${b}" />`;
const SCREENS: Record<string, string> = {
  list: node('Accounts for Owner', 'android:id/title', '[63,1156][1038,1207]') + node('eu@gmail.com', 'android:id/title', '[189,1270][701,1341]'),
  detail: node('eu@gmail.com', 'android:id/title', '[0,100][500,200]') + node('Remove account', 'com.android.settings:id/button', '[100,1800][500,1900]'),
  dialog: node('Remove account?', 'android:id/alertTitle', '[0,500][800,600]') + node('Remove account', 'android:id/button1', '[600,1000][1000,1100]'),
  empty: node('Add account', 'android:id/title', '[189,1270][487,1341]'),
};

/** Aparelho de mentira: cada toque no lugar certo passa para a próxima tela; o confirmar remove a conta. */
function fakePhone(o: { listScreen?: string } = {}) {
  let screen = 'home'; let accounts = 1; const log: string[] = [];
  const shell = async (_s: string, cmd: readonly string[]) => {
    const c = cmd.join(' '); log.push(c);
    if (c.startsWith('am start')) screen = o.listScreen ?? (accounts ? 'list' : 'empty');
    if (c.startsWith('cat ')) return `<hierarchy>${SCREENS[screen] ?? ''}</hierarchy>`;
    if (c.startsWith('dumpsys account')) return accounts ? 'Accounts: 1\n  Account {name=eu@gmail.com, type=com.google}' : 'Accounts: 0';
    if (c.startsWith('input tap')) {
      const [x, y] = cmd.slice(2).map(Number);
      if (screen === 'list' && y > 1270 && y < 1341) screen = 'detail';
      else if (screen === 'detail' && y > 1800 && y < 1900) screen = 'dialog';
      else if (screen === 'dialog' && x > 600 && y > 1000 && y < 1100) { accounts = 0; screen = 'empty'; }
    }
    return '';
  };
  return { adb: { shell }, log, accounts: () => accounts };
}

describe('removeGoogleAccount', () => {
  it('abre Senhas e contas, toca na conta pelo e-mail, em Remover conta e confirma; sem modelo de linguagem', async () => {
    const p = fakePhone();
    await removeGoogleAccount(p.adb, 's', 'eu@gmail.com', { sleep: async () => {} });
    expect(p.accounts()).toBe(0);
    expect(p.log).toContain('am start -a android.settings.SYNC_SETTINGS');
    expect(p.log).toContain('input keyevent KEYCODE_HOME');
    expect(p.log.at(-1)).toBe('dumpsys account');
  });
  it('sem o e-mail guardado: toca na primeira linha que parece e-mail', async () => {
    const p = fakePhone();
    await removeGoogleAccount(p.adb, 's', null, { sleep: async () => {} });
    expect(p.accounts()).toBe(0);
  });
  it('sem a conta na lista: erro claro, nada tocado às cegas', async () => {
    const p = fakePhone({ listScreen: 'empty' });
    await expect(removeGoogleAccount(p.adb, 's', 'eu@gmail.com', { sleep: async () => {} })).rejects.toThrow(/não achei a conta/);
    expect(p.log.some((l) => l.startsWith('input tap'))).toBe(false);
  });
});
