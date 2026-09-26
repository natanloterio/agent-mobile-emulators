import { describe, expect, it } from 'vitest';
import { ALL_NAMESPACES } from './messages';
import { detectLocale, LOCALES } from './locales';
import { createI18n, PT } from './translate';

describe('detectLocale', () => {
  it('pega o primeiro idioma suportado pelo prefixo; senão português', () => {
    expect(detectLocale(['zh-Hans-CN', 'en'])).toBe('zh');
    expect(detectLocale(['ja-JP', 'de-AT'])).toBe('de');
    expect(detectLocale(['ja-JP'])).toBe('pt');
    expect(detectLocale([])).toBe('pt');
  });
});

describe('createI18n', () => {
  it('traduz e interpola', () => {
    expect(PT.t('shell.nav.report')).toBe('Relatório');
    expect(createI18n('en').t('shell.meters.ceiling', { cpu: 8, adb: 16 })).toBe('Ceiling: 8 by CPU · 16 by adb');
    expect(createI18n('zh').t('shell.nav.ids')).toBe('身份');
  });
  it('dólar e decimal no formato de cada idioma', () => {
    expect(PT.fmt.usd(0.41)).toBe('US$ 0,41');
    expect(createI18n('en').fmt.usd(0.41)).toBe('$0.41');
    expect(createI18n('de').fmt.decimal(4.6)).toBe('4,6');
    expect(createI18n('en').fmt.decimal(4.6)).toBe('4.6');
  });
  it('todos os idiomas têm todas as chaves de todos os namespaces, sem texto vazio', () => {
    for (const [ns, byLocale] of Object.entries(ALL_NAMESPACES)) {
      const keys = Object.keys(byLocale.pt).sort();
      for (const l of LOCALES) {
        const dict = (byLocale as Record<string, Record<string, string>>)[l];
        expect(Object.keys(dict).sort(), `${ns}/${l}`).toEqual(keys);
        for (const k of keys) expect(dict[k].trim().length, `${ns}/${l}/${k}`).toBeGreaterThan(0);
      }
    }
  });
  it('placeholders iguais em todos os idiomas', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const [ns, byLocale] of Object.entries(ALL_NAMESPACES)) {
      for (const [k, v] of Object.entries(byLocale.pt)) {
        for (const l of LOCALES) expect(ph((byLocale as Record<string, Record<string, string>>)[l][k]), `${ns}/${l}/${k}`).toBe(ph(v));
      }
    }
  });
});
