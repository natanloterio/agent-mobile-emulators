import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrateDataDir, migrateUserData, type MigrateDeps } from './legacy-migrate.js';

const HOME = '/h';
const OLD = path.join(HOME, '.local', 'share', 'enxame');
const NEW = path.join(HOME, '.local', 'share', 'tapflock');

/** Sistema de arquivos em memória: caminho → conteúdo (null = pasta). Renomear leva os filhos junto. */
function fakeDeps(files: Record<string, string | null>, o: { alive?: (pid: number) => boolean; failRename?: (from: string) => boolean } = {}) {
  const fs = new Map(Object.entries(files));
  const stopped: number[] = [];
  const logs: string[] = [];
  const deps: MigrateDeps = {
    exists: (p) => fs.has(p),
    rename: (from, to) => {
      if (o.failRename?.(from)) throw new Error(`EPERM: ${from}`);
      for (const [k, v] of [...fs]) {
        if (k === from || k.startsWith(from + path.sep)) { fs.delete(k); fs.set(to + k.slice(from.length), v); }
      }
    },
    readFile: (p) => { const v = fs.get(p); if (typeof v !== 'string') throw new Error(`ENOENT: ${p}`); return v; },
    writeFile: (p, data) => { fs.set(p, data); },
    alive: o.alive ?? (() => false),
    stop: (pid) => { stopped.push(pid); },
    sleep: async () => {},
    log: (m) => { logs.push(m); },
  };
  return { deps, fs, stopped, logs };
}

describe('migrateDataDir', () => {
  it('move a pasta, renomeia o banco com o WAL e reescreve os caminhos do setup.json', async () => {
    const setup = JSON.stringify({ done: true, paths: { sdkRoot: '/h/Android/Sdk', ollamaBin: path.join(OLD, 'tools', 'ollama', 'bin', 'ollama') } });
    const { deps, fs } = fakeDeps({
      [OLD]: null, [path.join(OLD, 'enxame.sqlite')]: 'db', [path.join(OLD, 'enxame.sqlite-wal')]: 'wal',
      [path.join(OLD, 'setup.json')]: setup,
    });
    expect(await migrateDataDir({}, HOME, deps)).toBe('migrated');
    expect(fs.has(OLD)).toBe(false);
    expect(fs.get(path.join(NEW, 'tapflock.sqlite'))).toBe('db');
    expect(fs.get(path.join(NEW, 'tapflock.sqlite-wal'))).toBe('wal');
    expect(fs.has(path.join(NEW, 'enxame.sqlite'))).toBe(false);
    const paths = JSON.parse(fs.get(path.join(NEW, 'setup.json')) as string).paths;
    expect(paths).toEqual({ sdkRoot: '/h/Android/Sdk', ollamaBin: path.join(NEW, 'tools', 'ollama', 'bin', 'ollama') });
  });

  it('nada a fazer: sem pasta antiga, pasta nova já existe ou pasta escolhida por env', async () => {
    expect(await migrateDataDir({}, HOME, fakeDeps({}).deps)).toBe('skipped');
    expect(await migrateDataDir({}, HOME, fakeDeps({ [OLD]: null, [NEW]: null }).deps)).toBe('skipped');
    expect(await migrateDataDir({ ENXAME_DATA_DIR: '/x' }, HOME, fakeDeps({ [OLD]: null }).deps)).toBe('skipped');
    expect(await migrateDataDir({ TAPFLOCK_DATA_DIR: '/x' }, HOME, fakeDeps({ [OLD]: null }).deps)).toBe('skipped');
  });

  it('para o daemon antigo que ainda roda antes de mover a pasta', async () => {
    let running = true;
    const { deps, stopped, fs } = fakeDeps(
      { [OLD]: null, [path.join(OLD, 'daemon.json')]: JSON.stringify({ port: 1, token: 't', pid: 42 }) },
      { alive: () => running },
    );
    deps.stop = (pid) => { stopped.push(pid); running = false; };
    expect(await migrateDataDir({}, HOME, deps)).toBe('migrated');
    expect(stopped).toEqual([42]);
    expect(fs.has(NEW)).toBe(true);
  });

  it('daemon antigo que não para: não mexe em nada e segue na pasta antiga', async () => {
    const { deps, fs, logs } = fakeDeps(
      { [OLD]: null, [path.join(OLD, 'daemon.json')]: JSON.stringify({ port: 1, token: 't', pid: 42 }) },
      { alive: () => true },
    );
    expect(await migrateDataDir({}, HOME, deps)).toBe('failed');
    expect(fs.has(OLD)).toBe(true);
    expect(logs.join('\n')).toContain('42');
  });

  it('pasta que não dá para renomear (Windows com arquivo aberto): segue na antiga', async () => {
    const { deps, fs } = fakeDeps({ [OLD]: null, [path.join(OLD, 'enxame.sqlite')]: 'db' }, { failRename: (from) => from === OLD });
    expect(await migrateDataDir({}, HOME, deps)).toBe('failed');
    expect(fs.get(path.join(OLD, 'enxame.sqlite'))).toBe('db');
  });

  it('banco que não dá para renomear: desfaz o WAL já renomeado e mantém o nome antigo', async () => {
    const { deps, fs } = fakeDeps(
      { [OLD]: null, [path.join(OLD, 'enxame.sqlite')]: 'db', [path.join(OLD, 'enxame.sqlite-wal')]: 'wal' },
      { failRename: (from) => from === path.join(NEW, 'enxame.sqlite') },
    );
    expect(await migrateDataDir({}, HOME, deps)).toBe('migrated');
    expect(fs.get(path.join(NEW, 'enxame.sqlite'))).toBe('db');
    expect(fs.get(path.join(NEW, 'enxame.sqlite-wal'))).toBe('wal');
    expect(fs.has(path.join(NEW, 'tapflock.sqlite-wal'))).toBe(false);
  });

  it('setup.json ilegível não impede a migração', async () => {
    const { deps, fs } = fakeDeps({ [OLD]: null, [path.join(OLD, 'setup.json')]: '{quebrado' });
    expect(await migrateDataDir({}, HOME, deps)).toBe('migrated');
    expect(fs.get(path.join(NEW, 'setup.json'))).toBe('{quebrado');
  });
});

describe('migrateUserData', () => {
  const appData = '/h/.config';
  it('move a pasta de perfil do Electron quando só existe a antiga', () => {
    const { deps, fs } = fakeDeps({ [path.join(appData, 'Enxame')]: null, [path.join(appData, 'Enxame', 'Local Storage')]: null });
    expect(migrateUserData(appData, deps)).toBe('migrated');
    expect(fs.has(path.join(appData, 'Tapflock', 'Local Storage'))).toBe(true);
  });

  it('nada a fazer com a nova presente ou sem a antiga; falha no rename só registra', () => {
    expect(migrateUserData(appData, fakeDeps({ [path.join(appData, 'Enxame')]: null, [path.join(appData, 'Tapflock')]: null }).deps)).toBe('skipped');
    expect(migrateUserData(appData, fakeDeps({}).deps)).toBe('skipped');
    const broken = fakeDeps({ [path.join(appData, 'Enxame')]: null }, { failRename: () => true });
    expect(migrateUserData(appData, broken.deps)).toBe('failed');
    expect(broken.logs.length).toBe(1);
  });
});
