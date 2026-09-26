import { describe, expect, it } from 'vitest';
import { apiErrorMessage, createGestureSender, sendGesture, setControl, type ApiFn } from './control';
import type { InputGesture } from './types';

const fakeApi = (impl: (method: string, path: string, body?: unknown) => Promise<unknown> = async () => null) => {
  const calls: [string, string, unknown][] = [];
  const api: ApiFn = async (method, path, body) => { calls.push([method, path, body]); return impl(method, path, body); };
  return { api, calls };
};

describe('setControl / sendGesture', () => {
  it('chamam as rotas do contrato com o corpo certo', async () => {
    const { api, calls } = fakeApi(async (_m, p) => (p.endsWith('/control') ? { id: 'conta1', controlled: true } : null));
    expect(await setControl(api, 'conta1', true)).toEqual({ id: 'conta1', controlled: true });
    await sendGesture(api, 'conta1', { kind: 'tap', x: 0.5, y: 0.5 });
    expect(calls).toEqual([
      ['POST', '/identities/conta1/control', { on: true }],
      ['POST', '/identities/conta1/input', { kind: 'tap', x: 0.5, y: 0.5 }],
    ]);
  });
  it('id com caractere especial é codificado (o main recusa, nunca vira outra rota)', async () => {
    const { api, calls } = fakeApi();
    await sendGesture(api, '../kill', { kind: 'key', key: 'home' });
    expect(calls[0][1]).toBe('/identities/..%2Fkill/input');
  });
});

describe('apiErrorMessage', () => {
  it('extrai o `error` do JSON que o main embute na mensagem', () => {
    expect(apiErrorMessage(new Error(`Error invoking remote method 'enxame:api': Error: /identities/conta1/input → 409: {"error":"sem controle"}`))).toBe('sem controle');
    expect(apiErrorMessage(new Error('x → 400: {"error":["kind: inválido","x: y"]}'))).toBe('kind: inválido; x: y');
  });
  it('sem JSON: a própria mensagem; não-Error: String', () => {
    expect(apiErrorMessage(new Error('falhou'))).toBe('falhou');
    expect(apiErrorMessage('boom')).toBe('boom');
  });
});

describe('createGestureSender', () => {
  it('serializa os envios (texto antes do enter) e reporta erro sem parar a fila', async () => {
    const order: string[] = []; const errors: string[] = [];
    let releaseFirst!: () => void;
    const first = new Promise<void>((r) => { releaseFirst = r; });
    const { api } = fakeApi(async (_m, _p, body) => {
      const g = body as InputGesture;
      if (g.kind === 'text') await first;
      if (g.kind === 'key' && g.key === 'del') throw new Error('x → 502: {"error":"adb caiu"}');
      order.push(g.kind);
      return null;
    });
    const send = createGestureSender(api, 'conta1', (m) => errors.push(m));
    send({ kind: 'text', text: 'oi' }); send({ kind: 'key', key: 'del' }); const last = send({ kind: 'key', key: 'enter' });
    await new Promise((r) => setTimeout(r, 5));
    expect(order).toEqual([]);
    releaseFirst(); await last;
    expect(order).toEqual(['text', 'key']);
    expect(errors).toEqual(['adb caiu']);
  });
});
