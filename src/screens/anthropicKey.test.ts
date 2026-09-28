import { describe, expect, it } from 'vitest';
import { keyNotice, parseKeyStatus } from './anthropicKey';

describe('parseKeyStatus', () => {
  it('lê só configured e source; formato estranho vira null', () => {
    expect(parseKeyStatus({ configured: true, source: 'vault' })).toEqual({ configured: true, source: 'vault' });
    expect(parseKeyStatus({ configured: false, source: null })).toEqual({ configured: false, source: null });
    expect(parseKeyStatus({ configured: 'sim' })).toBeNull();
  });
});

describe('keyNotice', () => {
  it('sem chave e com papel na nuvem é erro; sem papel na nuvem é só informação; com chave diz de onde veio', () => {
    expect(keyNotice({ configured: false, source: null }, true)).toEqual({ key: 'providers.key.missingNeeded', tone: 'error' });
    expect(keyNotice({ configured: false, source: null }, false)).toEqual({ key: 'providers.key.missing', tone: 'info' });
    expect(keyNotice({ configured: true, source: 'env' }, true)).toEqual({ key: 'providers.key.fromEnv', tone: 'info' });
    expect(keyNotice({ configured: true, source: 'vault' }, true)).toEqual({ key: 'providers.key.fromVault', tone: 'info' });
  });
});
