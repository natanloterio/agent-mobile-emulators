import { describe, expect, it } from 'vitest';
import { platformId, systemImage } from './platform';

describe('platformId', () => {
  it('as quatro suportadas', () => {
    expect(platformId('linux', 'x64')).toBe('linux-x64');
    expect(platformId('darwin', 'x64')).toBe('darwin-x64');
    expect(platformId('darwin', 'arm64')).toBe('darwin-arm64');
    expect(platformId('win32', 'x64')).toBe('win32-x64');
  });
  it('o resto não é suportado', () => {
    expect(platformId('linux', 'arm64')).toBeNull();
    expect(platformId('win32', 'arm64')).toBeNull();
    expect(platformId('freebsd', 'x64')).toBeNull();
  });
});

describe('systemImage', () => {
  it('arm64-v8a só no Apple Silicon', () => {
    expect(systemImage('darwin-arm64')).toBe('system-images;android-34;google_apis_playstore;arm64-v8a');
    expect(systemImage('darwin-x64')).toBe('system-images;android-34;google_apis_playstore;x86_64');
    expect(systemImage('linux-x64')).toBe('system-images;android-34;google_apis_playstore;x86_64');
    expect(systemImage('win32-x64')).toBe('system-images;android-34;google_apis_playstore;x86_64');
  });
});
