import { describe, expect, it } from 'vitest';
import { freezeTargetApp, googleAccountOnDevice, setupMcpApp } from '../src/base/device-setup.js';

const PKG = 'com.x.mcp';
function fakeAdb(o: { installed?: boolean; accessibility?: string } = {}) {
  const log: string[] = [];
  return {
    log,
    adb: {
      shell: async (_s: string, cmd: readonly string[]) => {
        log.push(cmd.join(' '));
        if (cmd[0] === 'pm' && cmd[1] === 'path') return o.installed ? `package:/data/app/${PKG}/base.apk` : '';
        if (cmd[1] === 'get') return o.accessibility ?? 'null';
        return '';
      },
      install: async (_s: string, apk: string) => { log.push(`install ${apk}`); },
      broadcastConfigure: async (_s: string, extras: Record<string, unknown>) => { log.push(`configure ${JSON.stringify(extras)}`); },
    },
  };
}

describe('setupMcpApp', () => {
  it('instala quando falta, liga a acessibilidade e o início automático', async () => {
    const { adb, log } = fakeAdb();
    await setupMcpApp(adb, 's', { pkg: PKG, apk: async () => '/c/mcp.apk' });
    expect(log).toEqual([
      `pm path ${PKG}`, 'install /c/mcp.apk', 'settings get secure enabled_accessibility_services',
      `settings put secure enabled_accessibility_services ${PKG}/com.danielealbano.androidremotecontrolmcp.services.accessibility.McpAccessibilityService`,
      'settings put secure accessibility_enabled 1', 'configure {"auto_start_on_boot":true}',
    ]);
  });
  it('já instalado: não baixa nem reinstala; preserva outros serviços de acessibilidade sem duplicar o nosso', async () => {
    const comp = `${PKG}/com.danielealbano.androidremotecontrolmcp.services.accessibility.McpAccessibilityService`;
    const { adb, log } = fakeAdb({ installed: true, accessibility: `outro/Svc:${comp}` });
    await setupMcpApp(adb, 's', { pkg: PKG, apk: async () => { throw new Error('não baixa'); } });
    expect(log).not.toContain('install /c/mcp.apk');
    expect(log).toContain(`settings put secure enabled_accessibility_services outro/Svc:${comp}`);
  });
});

describe('freezeTargetApp', () => {
  it('desliga a Play Store da base (o app alvo não se atualiza sozinho nos clones)', async () => {
    const { adb, log } = fakeAdb();
    await freezeTargetApp(adb, 's');
    expect(log).toEqual(['pm disable-user --user 0 com.android.vending']);
  });
});

describe('googleAccountOnDevice', () => {
  it('acha conta com.google no dumpsys account; outras contas não contam', async () => {
    const with_ = { shell: async () => 'Accounts: 1\n  Account {name=eu@gmail.com, type=com.google}' };
    const without = { shell: async () => 'Accounts: 1\n  Account {name=x, type=com.whatsapp}' };
    expect(await googleAccountOnDevice(with_, 's')).toBe(true);
    expect(await googleAccountOnDevice(without, 's')).toBe(false);
  });
});
