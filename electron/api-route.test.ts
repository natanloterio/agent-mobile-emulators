import { describe, expect, it } from 'vitest';
import { apiRoute } from './api-route';

describe('apiRoute', () => {
  it('aceita as rotas do contrato', () => {
    expect(apiRoute('post', '/goals/plan')).toEqual({ method: 'POST', path: '/goals/plan' });
    expect(apiRoute('POST', '/identities/conta2/input').path).toBe('/identities/conta2/input');
    expect(apiRoute('GET', '/goals').method).toBe('GET');
    expect(apiRoute('POST', '/resume').path).toBe('/resume');
  });
  it('recusa fora da lista, query, traversal e método errado', () => {
    expect(() => apiRoute('DELETE', '/goals')).toThrow();
    expect(() => apiRoute('GET', '/providers?x=1')).toThrow();
    expect(() => apiRoute('POST', '/identities/../kill/pause')).toThrow();
    expect(() => apiRoute('POST', '/identities/conta1/rm')).toThrow();
    expect(() => apiRoute('GET', '/goals/plan')).toThrow();
  });
  it('login pelo daemon não passa pelo canal genérico (só o main manda a senha)', () => {
    expect(() => apiRoute('POST', '/identities/conta1/login')).toThrow();
  });
});
