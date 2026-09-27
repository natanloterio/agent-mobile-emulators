import { describe, expect, it } from 'vitest';
import { daemonSpawnSpec } from './daemon-bridge';

describe('daemonSpawnSpec', () => {
  it('empacotado: roda o daemon de dentro do app.asar no binário do Electron, sem .env', () => {
    const s = daemonSpawnSpec({ isPackaged: true, appPath: '/opt/Enxame/resources/app.asar', resourcesPath: '/opt/Enxame/resources', execPath: '/opt/Enxame/enxame', env: { PATH: '/bin' }, dotenv: 'ANTHROPIC_API_KEY=sk-ant-x' });
    expect(s.cmd).toBe('/opt/Enxame/enxame');
    expect(s.args).toEqual(['/opt/Enxame/resources/app.asar/dist-daemon/index.js']);
    expect(s.cwd).toBe('/opt/Enxame/resources');
    expect(s.env).toEqual({ PATH: '/bin', ELECTRON_RUN_AS_NODE: '1' });
    expect(s.isPackaged).toBe(true);
  });
  it('desenvolvimento: usa o dist-daemon do projeto e carrega o .env sem sobrescrever o ambiente', () => {
    const s = daemonSpawnSpec({ isPackaged: false, appPath: '/src/enxame', resourcesPath: '/x', execPath: '/src/enxame/node_modules/electron/dist/electron', env: { PATH: '/bin', ENXAME_PORT: '1' }, dotenv: 'ANTHROPIC_API_KEY=sk-ant-x\nENXAME_PORT=2\n' });
    expect(s.args).toEqual(['/src/enxame/dist-daemon/index.js']);
    expect(s.cwd).toBe('/src/enxame');
    expect(s.env).toEqual({ PATH: '/bin', ENXAME_PORT: '1', ANTHROPIC_API_KEY: 'sk-ant-x', ELECTRON_RUN_AS_NODE: '1' });
    expect(s.isPackaged).toBe(false);
  });
  it('desenvolvimento sem .env', () => {
    expect(daemonSpawnSpec({ isPackaged: false, appPath: '/p', resourcesPath: '/x', execPath: '/e', env: {}, dotenv: null }).env).toEqual({ ELECTRON_RUN_AS_NODE: '1' });
  });
});
