import { describe, expect, it } from 'vitest';
import { providerRoute } from './provider-route.js';

describe('providerRoute', () => {
  it('monta os três caminhos para papéis válidos', () => {
    expect(providerRoute('worker', 'put')).toBe('/providers/worker');
    expect(providerRoute('esc', 'test')).toBe('/providers/esc/test');
    expect(providerRoute('lider', 'models')).toBe('/providers/models?role=lider');
  });
  it('rejeita papel fora da lista ou com caracteres de path/query', () => {
    for (const r of ['chefe', '../kill?x=', 'worker/test', 'worker?x=1', '']) expect(() => providerRoute(r, 'put'), r).toThrow(/papel inválido/);
  });
});
