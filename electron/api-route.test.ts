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
  it('rotas de missão entram; credenciais continuam fora do canal genérico', () => {
    expect(apiRoute('POST', '/missions')).toEqual({ method: 'POST', path: '/missions' });
    expect(apiRoute('post', '/missions/0b6f6c1e-8a1d-4b43-9d0e-2b1f3c4d5e6f/continue').path).toBe('/missions/0b6f6c1e-8a1d-4b43-9d0e-2b1f3c4d5e6f/continue');
    for (const a of ['pause', 'resume', 'abandon', 'instruct']) expect(() => apiRoute('POST', `/missions/m-1/${a}`)).not.toThrow();
    expect(() => apiRoute('POST', '/missions/m-1/voar')).toThrow();
    expect(() => apiRoute('POST', '/missions/../kill')).toThrow();
    expect(() => apiRoute('GET', '/credentials')).toThrow();
    expect(() => apiRoute('PUT', '/identities/conta1/credentials')).toThrow();
  });
  it('limites dos agentes: GET e PUT em /settings/budgets entram no canal genérico', () => {
    expect(apiRoute('GET', '/settings/budgets')).toEqual({ method: 'GET', path: '/settings/budgets' });
    expect(apiRoute('put', '/settings/budgets').method).toBe('PUT');
    expect(() => apiRoute('POST', '/settings/budgets')).toThrow();
    expect(() => apiRoute('GET', '/settings/budgets/x')).toThrow();
  });
  it('paralelismo local: GET e PUT em /settings/local entram no canal genérico', () => {
    expect(apiRoute('GET', '/settings/local')).toEqual({ method: 'GET', path: '/settings/local' });
    expect(apiRoute('put', '/settings/local').method).toBe('PUT');
    expect(() => apiRoute('POST', '/settings/local')).toThrow();
    expect(() => apiRoute('GET', '/settings/local/x')).toThrow();
  });
});
