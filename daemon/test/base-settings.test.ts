import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { IDLE_PREP, readBasePrep, readTargetVersion, writeBasePrep, writeTargetVersion } from '../src/db/base-settings.js';

describe('configurações do celular-base', () => {
  it('versão oficial: a do preparo; sem preparo, a do CONFIG', () => {
    const db = openDb(':memory:');
    expect(readTargetVersion(db)).toBe('448.0.0.52.84');
    writeTargetVersion(db, '450.1.0');
    expect(readTargetVersion(db)).toBe('450.1.0');
  });
  it('andamento persiste; sem linha é ocioso', () => {
    const db = openDb(':memory:');
    expect(readBasePrep(db)).toEqual(IDLE_PREP);
    writeBasePrep(db, { ...IDLE_PREP, state: 'running', phase: 'mcp' });
    expect(readBasePrep(db)).toMatchObject({ state: 'running', phase: 'mcp' });
  });
});
