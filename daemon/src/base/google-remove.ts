import type { Adb } from '../device/adb.js';
import { center, findNode, parseUiDump, type UiNode } from '../device/ui-dump.js';
import { googleAccountOnDevice } from './device-setup.js';

type ShellAdb = Pick<Adb, 'shell'>;
const DUMP = '/sdcard/tapflock-ui.xml';
const SETTLE_MS = 1500;
const TRIES = 4;
/** "Remover conta" nos idiomas que o emulador costuma ter; o botão de confirmar do diálogo é sempre `android:id/button1`. */
const REMOVE = /^(remove account|remover conta|quitar cuenta|eliminar cuenta|supprimer le compte|konto entfernen|移除帐号|删除帐号)$/i;

async function screen(adb: ShellAdb, serial: string): Promise<readonly UiNode[]> {
  await adb.shell(serial, ['uiautomator', 'dump', DUMP]);
  return parseUiDump(await adb.shell(serial, ['cat', DUMP]));
}

/** Espera um nó aparecer (a tela das Configurações demora um pouco a desenhar) e toca no centro dele. */
async function tapWhen(adb: ShellAdb, serial: string, pred: (n: UiNode) => boolean, what: string, sleep: (ms: number) => Promise<void>): Promise<void> {
  for (let i = 0; i < TRIES; i++) {
    await sleep(SETTLE_MS);
    const n = findNode(await screen(adb, serial), pred);
    if (n) { const [x, y] = center(n); await adb.shell(serial, ['input', 'tap', String(x), String(y)]); return; }
  }
  throw new Error(`não achei ${what} na tela das Configurações`);
}

/**
 * Tira a conta Google do celular-base pelas Configurações, sem modelo de linguagem: é um caminho fixo (Senhas e
 * contas → a conta → Remover conta → confirmar), e um modelo pequeno se perde nele. A conta é achada pelo e-mail,
 * que independe do idioma do aparelho.
 */
export async function removeGoogleAccount(adb: ShellAdb, serial: string, email: string | null, o: { readonly sleep?: (ms: number) => Promise<void> } = {}): Promise<void> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const mail = email?.trim().toLowerCase() ?? null;
  // Sem o e-mail guardado (conta posta à mão no aparelho): a primeira linha que parece um e-mail.
  const isAccount = (n: UiNode) => (mail ? n.text.trim().toLowerCase() === mail : /^\S+@\S+\.\S+$/.test(n.text.trim()));
  await adb.shell(serial, ['am', 'start', '-a', 'android.settings.SYNC_SETTINGS']);
  await tapWhen(adb, serial, isAccount, `a conta ${email ?? 'Google'}`, sleep);
  await tapWhen(adb, serial, (n) => REMOVE.test(n.text.trim()), 'o botão Remover conta', sleep);
  await tapWhen(adb, serial, (n) => n.resourceId === 'android:id/button1', 'a confirmação da remoção', sleep);
  await sleep(SETTLE_MS);
  await adb.shell(serial, ['input', 'keyevent', 'KEYCODE_HOME']);
  if (await googleAccountOnDevice(adb, serial)) throw new Error('a conta Google continua no celular-base');
}
