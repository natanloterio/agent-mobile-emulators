import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { daemonSpawnSpec } from './daemon-bridge';

describe('daemonSpawnSpec', () => {
  it('empacotado: roda o daemon de dentro do app.asar no binário do Electron, sem .env', () => {
    const s = daemonSpawnSpec({ isPackaged: true, appPath: '/opt/Tapflock/resources/app.asar', resourcesPath: '/opt/Tapflock/resources', execPath: '/opt/Tapflock/tapflock', env: { PATH: '/bin' }, dotenv: 'ANTHROPIC_API_KEY=sk-ant-x' });
    expect(s.cmd).toBe('/opt/Tapflock/tapflock');
    expect(s.args).toEqual([path.join('/opt/Tapflock/resources/app.asar', 'dist-daemon', 'index.js')]);
    expect(s.cwd).toBe('/opt/Tapflock/resources');
    expect(s.env).toEqual({ PATH: '/bin', ELECTRON_RUN_AS_NODE: '1' });
    expect(s.isPackaged).toBe(true);
  });
  it('desenvolvimento: usa o dist-daemon do projeto e carrega o .env sem sobrescrever o ambiente', () => {
    const s = daemonSpawnSpec({ isPackaged: false, appPath: '/src/tapflock', resourcesPath: '/x', execPath: '/src/tapflock/node_modules/electron/dist/electron', env: { PATH: '/bin', TAPFLOCK_PORT: '1' }, dotenv: 'ANTHROPIC_API_KEY=sk-ant-x\nTAPFLOCK_PORT=2\n' });
    expect(s.args).toEqual([path.join('/src/tapflock', 'dist-daemon', 'index.js')]);
    expect(s.cwd).toBe('/src/tapflock');
    expect(s.env).toEqual({ PATH: '/bin', TAPFLOCK_PORT: '1', ANTHROPIC_API_KEY: 'sk-ant-x', ELECTRON_RUN_AS_NODE: '1' });
    expect(s.isPackaged).toBe(false);
  });
  it('desenvolvimento sem .env', () => {
    expect(daemonSpawnSpec({ isPackaged: false, appPath: '/p', resourcesPath: '/x', execPath: '/e', env: {}, dotenv: null }).env).toEqual({ ELECTRON_RUN_AS_NODE: '1' });
  });
});
