import { describe, expect, it } from 'vitest';
import { daemonErrorText, unwrapDaemonError } from './daemonErrors';
import { createI18n } from './translate';

const en = createI18n('en').t;
const pt = createI18n('pt').t;

describe('unwrapDaemonError', () => {
  it('tira o envelope "rota → status: {json}" do main e junta listas de erro', () => {
    expect(unwrapDaemonError('/identities → 409: {"error":"identidade pausada"}')).toBe('identidade pausada');
    expect(unwrapDaemonError('/base/google → 400: {"error":["e-mail inválido","senha vazia"]}')).toBe('e-mail inválido; senha vazia');
    expect(unwrapDaemonError('texto solto')).toBe('texto solto');
    expect(unwrapDaemonError('{"error":["PIN inválido","handle inválido"]}')).toBe('PIN inválido; handle inválido');
  });
});

describe('daemonErrorText', () => {
  it('traduz as mensagens conhecidas do daemon, com os parâmetros', () => {
    expect(daemonErrorText('/identities → 409: {"error":"AVD-base tapflock_golden em uso (emulator-5554): pare esse emulador antes de provisionar"}', en))
      .toBe('The base phone tapflock_golden is running (emulator-5554): close that emulator before provisioning.');
    expect(daemonErrorText('emulador tapflock_conta2 não completou o boot em 180 s', en)).toBe("Emulator tapflock_conta2 didn't finish starting in 180 s.");
    expect(daemonErrorText('nenhuma identidade livre para o tool-call canônico (todas rodando, pausadas, controladas ou sem conta)', en))
      .toBe('No free identity for the test (all running, paused, under control or without an account).');
    expect(daemonErrorText('Ollama parado — o próximo teste ou objetivo o sobe', en)).toBe('Ollama · stopped — the next test or goal starts it');
    expect(daemonErrorText("daemon não conectado: o daemon parou", en)).toBe("Tapflock's background service isn't connected. Try again in a moment.");
    expect(daemonErrorText('conta1 não pronta: sonda falhou (infra)', en)).toBe("conta1 isn't ready: sonda falhou (infra)");
  });
  it('desconhecida passa como veio (sem o envelope); em português fica no texto do catálogo', () => {
    expect(daemonErrorText('/x → 500: {"error":"algo novo"}', en)).toBe('algo novo');
    expect(daemonErrorText('identidade pausada', pt)).toBe('Esta identidade está pausada.');
  });
  it('mensagens do login conferido (spec guia) saem no idioma da tela', () => {
    const en = createI18n('en');
    expect(daemonErrorText('Instagram deslogado (tela de login): faça login à mão no device e depois marque como resolvido', en.t)).toBe(en.t('common.err.loggedOut'));
    expect(daemonErrorText('/identities/conta1/login-done → 409: {"error":"o Instagram ainda está na tela de login: entre na conta no celular e tente de novo"}', en.t)).toBe(en.t('common.err.stillLoggedOut'));
    expect(daemonErrorText("o Instagram pediu uma verificação: Confirm it's you", en.t)).toBe("Instagram asked for a verification: Confirm it's you");
    expect(daemonErrorText('o Instagram não abriu no celular: abra o app, entre na conta e tente de novo', en.t)).toBe(en.t('common.err.appNotOpen'));
    expect(daemonErrorText('não deu para conferir o login no celular: MCP recusou', en.t)).toBe('Couldn’t check the login on the phone: MCP recusou');
  });
  it('app de controle do celular sem resposta vira uma frase clara, sem "MCP" nem texto cru', () => {
    const en = createI18n('en');
    const raw = '/identities/conta2/login-done → 409: {"error":"não deu para conferir o login no celular: device não pronto para o login: MCP: fetch failed"}';
    expect(daemonErrorText(raw, en.t)).toBe(en.t('common.err.controlAppDown'));
    expect(daemonErrorText(raw, en.t)).not.toMatch(/MCP|fetch|pronto/);
  });
});
