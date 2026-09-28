import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { brandEnv, dataDirFrom, dbFileIn } from '../src/brand.js';

describe('brandEnv', () => {
  it('TAPFLOCK_* vence; ENXAME_* (nome antigo) ainda vale; vazio conta como ausente', () => {
    expect(brandEnv({ TAPFLOCK_PORT: '1', ENXAME_PORT: '2' }, 'PORT')).toBe('1');
    expect(brandEnv({ ENXAME_PORT: '2' }, 'PORT')).toBe('2');
    expect(brandEnv({ TAPFLOCK_PORT: '', ENXAME_PORT: '2' }, 'PORT')).toBe('2');
    expect(brandEnv({}, 'PORT')).toBeUndefined();
  });
});

describe('dataDirFrom', () => {
  const home = '/h';
  const fresh = path.join(home, '.local', 'share', 'tapflock');
  const legacy = path.join(home, '.local', 'share', 'enxame');
  it('variável de ambiente vence', () => {
    expect(dataDirFrom({ TAPFLOCK_DATA_DIR: '/x' }, home, () => true)).toBe('/x');
    expect(dataDirFrom({ ENXAME_DATA_DIR: '/y' }, home, () => true)).toBe('/y');
  });
  it('a pasta nova quando existe ou quando não há a antiga; a antiga enquanto não foi migrada', () => {
    expect(dataDirFrom({}, home, () => false)).toBe(fresh);
    expect(dataDirFrom({}, home, () => true)).toBe(fresh);
    expect(dataDirFrom({}, home, (p) => p === legacy)).toBe(legacy);
  });
});

describe('dbFileIn', () => {
  it('tapflock.sqlite, a menos que só exista o enxame.sqlite antigo', () => {
    expect(dbFileIn('/d', () => false)).toBe(path.join('/d', 'tapflock.sqlite'));
    expect(dbFileIn('/d', (p) => p === path.join('/d', 'enxame.sqlite'))).toBe(path.join('/d', 'enxame.sqlite'));
    expect(dbFileIn('/d', () => true)).toBe(path.join('/d', 'tapflock.sqlite'));
  });
});
