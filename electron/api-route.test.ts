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
  it('arquivos e sequência de missões; recusa traversal e ação desconhecida', () => {
    expect(apiRoute('POST', '/missions/chain').path).toBe('/missions/chain');
    expect(apiRoute('GET', '/files').method).toBe('GET');
    expect(apiRoute('GET', '/files/device/conta1').path).toBe('/files/device/conta1');
    expect(apiRoute('POST', '/files/export').path).toBe('/files/export');
    expect(apiRoute('POST', '/files/0b6f6c1e-8a1d-4b43/send').path).toBe('/files/0b6f6c1e-8a1d-4b43/send');
    expect(apiRoute('POST', '/files/abc/delete').path).toBe('/files/abc/delete');
    expect(() => apiRoute('POST', '/files/../kill/send')).toThrow();
    expect(() => apiRoute('POST', '/files/abc/rm')).toThrow();
    expect(() => apiRoute('GET', '/files/device/../x')).toThrow();
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
  it('Guia: só PUT em /settings/guide entra no canal genérico', () => {
    expect(apiRoute('PUT', '/settings/guide')).toEqual({ method: 'PUT', path: '/settings/guide' });
    expect(() => apiRoute('GET', '/settings/guide')).toThrow();
    expect(() => apiRoute('PUT', '/settings/guide/x')).toThrow();
  });
  it('paralelismo local: GET e PUT em /settings/local entram no canal genérico', () => {
    expect(apiRoute('GET', '/settings/local')).toEqual({ method: 'GET', path: '/settings/local' });
    expect(apiRoute('put', '/settings/local').method).toBe('PUT');
    expect(() => apiRoute('POST', '/settings/local')).toThrow();
    expect(() => apiRoute('GET', '/settings/local/x')).toThrow();
  });
});

describe('rotas do celular-base', () => {
  it('prepare e continue passam; google (senha) não passa pelo canal genérico', () => {
    expect(apiRoute('POST', '/base/prepare')).toEqual({ method: 'POST', path: '/base/prepare' });
    expect(apiRoute('POST', '/base/continue')).toEqual({ method: 'POST', path: '/base/continue' });
    expect(() => apiRoute('PUT', '/base/google')).toThrow(/não permitida/);
  });
});
