import { describe, expect, it } from 'vitest';
import { SetupError, toSetupError } from './errors.js';

describe('toSetupError', () => {
  it('ENOSPC e "no space left on device" viram disk-full', () => {
    expect(toSetupError(Object.assign(new Error('write'), { code: 'ENOSPC' })).kind).toBe('disk-full');
    expect(toSetupError(new Error('write /home/u/.ollama/models/blobs/sha256-e7: no space left on device')).kind).toBe('disk-full');
    expect(toSetupError(new Error('sdkmanager saiu com código 1: java.io.IOException: No space left on device')).kind).toBe('disk-full');
  });
  it('falhas de rede viram network', () => {
    expect(toSetupError(new TypeError('fetch failed')).kind).toBe('network');
    expect(toSetupError(Object.assign(new Error('x'), { code: 'ECONNRESET' })).kind).toBe('network');
    expect(toSetupError(Object.assign(new Error('x'), { code: 'ENOTFOUND' })).kind).toBe('network');
  });
  it('SetupError passa como está; o resto vira process com a mensagem cortada', () => {
    const e = new SetupError('checksum', 'não bate');
    expect(toSetupError(e)).toBe(e);
    const p = toSetupError(new Error('x'.repeat(500)));
    expect(p.kind).toBe('process');
    expect(p.message.length).toBeLessThanOrEqual(300);
  });
});
