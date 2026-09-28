import { describe, expect, it } from 'vitest';
import { createI18n } from '../i18n/translate';
import { fileSize } from './fileSize';

describe('fileSize', () => {
  it('KB, MB e GB com a vírgula do idioma', () => {
    const pt = createI18n('pt'); const en = createI18n('en');
    expect(fileSize(10, pt)).toBe('1 KB');
    expect(fileSize(300 * 1024, en)).toBe('300 KB');
    expect(fileSize(1.5 * 1024 * 1024, pt)).toBe('1,5 MB');
    expect(fileSize(1.5 * 1024 * 1024, en)).toBe('1.5 MB');
    expect(fileSize(2 * 1024 ** 3, en)).toBe('2.0 GB');
  });
});
