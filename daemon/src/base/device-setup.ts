import type { Adb } from '../device/adb.js';

const ACCESSIBILITY_COMPONENT = (pkg: string) => `${pkg}/com.danielealbano.androidremotecontrolmcp.services.accessibility.McpAccessibilityService`;
const PLAY_STORE = 'com.android.vending';

type SetupAdb = Pick<Adb, 'shell' | 'install' | 'broadcastConfigure'>;

export async function packageInstalled(adb: Pick<Adb, 'shell'>, serial: string, pkg: string): Promise<boolean> {
  const out = await adb.shell(serial, ['pm', 'path', pkg]).catch(() => '');
  return out.includes('package:');
}

/**
 * App MCP pronto no celular-base sem tocar na tela (README do app, "Headless setup via ADB"): instala com as permissões,
 * liga o serviço de acessibilidade (o `settings put` pelo adb não passa pela trava de "configuração restrita" do Android
 * 13+) e liga o início automático no boot, para as identidades clonadas subirem com o servidor MCP de pé.
 */
export async function setupMcpApp(adb: SetupAdb, serial: string, o: { readonly pkg: string; readonly apk: () => Promise<string> }): Promise<void> {
  if (!(await packageInstalled(adb, serial, o.pkg))) await adb.install(serial, await o.apk());
  const current = (await adb.shell(serial, ['settings', 'get', 'secure', 'enabled_accessibility_services']).catch(() => '')).trim();
  const component = ACCESSIBILITY_COMPONENT(o.pkg);
  const others = current && current !== 'null' ? current.split(':').filter((c) => c && c !== component) : [];
  await adb.shell(serial, ['settings', 'put', 'secure', 'enabled_accessibility_services', [...others, component].join(':')]);
  await adb.shell(serial, ['settings', 'put', 'secure', 'accessibility_enabled', '1']);
  await adb.broadcastConfigure(serial, { auto_start_on_boot: true });
}

/**
 * Fim do preparo: a Play Store desligada impede que o app alvo se atualize sozinho nos clones (a versão da base é a
 * registrada como oficial). Religável com `pm enable` se um dia for preciso atualizar a base.
 */
export async function freezeTargetApp(adb: Pick<Adb, 'shell'>, serial: string): Promise<void> {
  await adb.shell(serial, ['pm', 'disable-user', '--user', '0', PLAY_STORE]);
}

/**
 * Conta do tipo `com.google` registrada no aparelho (`dumpsys account`). Só as linhas `Account {name=…, type=…}`
 * contam: a mesma saída lista os tipos de autenticador instalados (`AuthenticatorDescription {type=com.google}`)
 * mesmo com `Accounts: 0`.
 */
export async function googleAccountOnDevice(adb: Pick<Adb, 'shell'>, serial: string): Promise<boolean> {
  const out = await adb.shell(serial, ['dumpsys', 'account']);
  return /Account \{name=[^,}]+, type=com\.google\}/.test(out);
}
