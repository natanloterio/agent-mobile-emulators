import { describe, expect, it, vi } from 'vitest';
import { classifyHumanReason, createHumanClaimCheck } from '../src/worker/human-claims.js';

describe('classifyHumanReason', () => {
  it.each([
    ['Please press the device’s volume up and power buttons simultaneously to capture a system screenshot', 'screenshot'],
    ['Tire um print da tela do post e salve na galeria', 'screenshot'],
    ['Não há ferramenta para capturar a tela', 'screenshot'],
    ['Para acessar e baixar a postagem do Instagram, é necessário que o usuário faça login', 'login'],
    ['User is not logged into Instagram; authentication is required', 'login'],
    ['o Instagram deslogou', 'login'],
    ['o provedor pediu número de telefone', null],
    ['Instagram pediu "confirme que é você" com código por SMS', null],
    ['captcha na criação da conta', null],
  ] as const)('%s → %s', (reason, kind) => {
    expect(classifyHumanReason(reason)).toBe(kind);
  });
});

describe('createHumanClaimCheck', () => {
  it('login alegado com a sessão de pé na tela: recusa e diz para seguir', async () => {
    const check = createHumanClaimCheck({ session: async () => 'logged-in', canCapture: true });
    expect(await check('o usuário precisa fazer login')).toMatch(/está logado/);
  });
  it('login alegado e a tela confirma (deslogado ou verificação): deixa pedir a pessoa', async () => {
    expect(await createHumanClaimCheck({ session: async () => 'logged-out', canCapture: true })('precisa fazer login')).toBeNull();
    expect(await createHumanClaimCheck({ session: async () => 'blocked', canCapture: true })('precisa fazer login')).toBeNull();
  });
  it('não deu para ler a tela: não recusa (na dúvida, a pessoa decide)', async () => {
    const check = createHumanClaimCheck({ session: async () => { throw new Error('MCP fora'); }, canCapture: true });
    expect(await check('precisa fazer login')).toBeNull();
  });
  it('pedido de print/botões: recusa apontando screen_capture, sem ler a tela', async () => {
    const session = vi.fn();
    const check = createHumanClaimCheck({ session, canCapture: true });
    expect(await check('aperte volume e power para tirar um print')).toMatch(/screen_capture/);
    expect(session).not.toHaveBeenCalled();
  });
  it('sem screen_capture disponível, o pedido de print passa', async () => {
    expect(await createHumanClaimCheck({ session: async () => 'logged-in', canCapture: false })('tire um print da tela')).toBeNull();
  });
  it('pedido legítimo passa direto', async () => {
    const session = vi.fn();
    expect(await createHumanClaimCheck({ session, canCapture: true })('código enviado por SMS')).toBeNull();
    expect(session).not.toHaveBeenCalled();
  });
});
