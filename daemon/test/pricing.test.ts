import { describe, expect, it } from 'vitest';
import { LOCAL_PRICING, pricingFor } from '../src/provider/factory.js';

const row = (mode: 'nuvem' | 'local', model: string) => ({ role: 'lider' as const, mode, model, endpoint: 'x' });

describe('pricingFor por modelo', () => {
  it('cada modelo de nuvem tem o seu preço', () => {
    expect(pricingFor(row('nuvem', 'claude-haiku-4-5'))).toEqual({ inputPerM: 1, outputPerM: 5, cacheReadPerM: 0.1 });
    expect(pricingFor(row('nuvem', 'claude-sonnet-5'))).toEqual({ inputPerM: 2, outputPerM: 10, cacheReadPerM: 0.2 });
    expect(pricingFor(row('nuvem', 'claude-opus-5'))).toEqual({ inputPerM: 5, outputPerM: 25, cacheReadPerM: 0.5 });
  });
  it('desconhecido na nuvem conta pelo mais caro; local é zero', () => {
    expect(pricingFor(row('nuvem', 'claude-xyz')).inputPerM).toBe(5);
    expect(pricingFor(row('local', 'gpt-oss:20b'))).toEqual(LOCAL_PRICING);
  });
});
