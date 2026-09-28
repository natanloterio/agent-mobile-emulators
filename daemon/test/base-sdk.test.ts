import { describe, expect, it } from 'vitest';
import { avdmanagerPath, avdmanagerSpawn, createAvdCommand, jreHome, systemImageId } from '../src/base/sdk-tools.js';

describe('ferramentas do SDK para o celular-base', () => {
  it('avdmanager fica nas cmdline-tools que o onboarding instalou (.bat no Windows)', () => {
    expect(avdmanagerPath('/sdk', 'linux')).toBe('/sdk/cmdline-tools/latest/bin/avdmanager');
    expect(avdmanagerPath('C:\\sdk', 'win32')).toBe('C:\\sdk\\cmdline-tools\\latest\\bin\\avdmanager.bat');
  });
  it('JRE do onboarding em <dados>/tools/jre (Contents/Home no macOS); ausente, usa o Java do sistema', () => {
    expect(jreHome('/d', 'linux', () => true)).toBe('/d/tools/jre');
    expect(jreHome('/d', 'darwin', () => true)).toBe('/d/tools/jre/Contents/Home');
    expect(jreHome('/d', 'linux', () => false)).toBeNull();
  });
  it('imagem Android 14 com Google Play: arm64 só no Mac com Apple Silicon', () => {
    expect(systemImageId('linux', 'x64')).toBe('system-images;android-34;google_apis_playstore;x86_64');
    expect(systemImageId('darwin', 'arm64')).toBe('system-images;android-34;google_apis_playstore;arm64-v8a');
  });
  it('comando sem perguntas: responde "no" ao perfil de hardware e já escolhe um aparelho', () => {
    expect(createAvdCommand('tapflock_golden', 'system-images;android-34;google_apis_playstore;x86_64')).toEqual({
      args: ['create', 'avd', '-n', 'tapflock_golden', '-k', 'system-images;android-34;google_apis_playstore;x86_64', '-d', 'pixel_6'],
      stdin: 'no\n',
    });
  });
  it('Windows: .bat pelo cmd com o caminho entre aspas (usuário com espaço no nome)', () => {
    expect(avdmanagerSpawn('/sdk/avdmanager', ['create', 'avd'], 'linux')).toEqual({ file: '/sdk/avdmanager', args: ['create', 'avd'], verbatim: false });
    expect(avdmanagerSpawn('C:\\Users\\John Doe\\avdmanager.bat', ['create', 'avd', '-n', 'x'], 'win32')).toEqual({
      file: 'cmd', args: ['/d', '/s', '/c', '""C:\\Users\\John Doe\\avdmanager.bat" create avd -n x"'], verbatim: true,
    });
  });
});
