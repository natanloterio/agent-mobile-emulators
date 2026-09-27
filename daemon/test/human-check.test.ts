import { describe, expect, it } from 'vitest';
import { detectHumanCheck, summarizeScreen } from '../src/screen/human-check.js';
import { parseScreen } from '../src/screen/parse.js';

const screen = (pkg: string, labels: readonly string[]) => parseScreen(
  `screen:1080x2400 density:420 orientation:portrait\n--- window:1 type:APPLICATION pkg:${pkg} title:x layer:0 focused:true ---\nnode_id\tclass\ttext\tdesc\tres_id\tbounds\tflags\n`
  + labels.map((l, i) => `node_${i}\tTextView\t${l}\t-\t-\t0,${i * 10},10,${i * 10 + 10}\ton,ena`).join('\n') + '\n');

describe('detectHumanCheck (modo missão)', () => {
  it('captcha em qualquer app (navegador) → motivo', () => {
    expect(detectHumanCheck(screen('com.android.chrome', ['Criar conta', "I'm not a robot"]))).toMatch(/not a robot/);
    expect(detectHumanCheck(screen('com.android.chrome', ['reCAPTCHA']))).toMatch(/reCAPTCHA/);
  });
  it('desafios do Instagram continuam parando', () => {
    expect(detectHumanCheck(screen('com.instagram.android', ['Choose a way to confirm your account']))).toBeTruthy();
    expect(detectHumanCheck(screen('com.instagram.android', ['Confirme que é você']))).toBeTruthy();
  });
  it('código enviado por e-mail e confirmação comum NÃO param', () => {
    expect(detectHumanCheck(screen('com.instagram.android', ['Enter the code we sent to a@b.c', 'Insira o código']))).toBeNull();
    expect(detectHumanCheck(screen('com.instagram.android', ['Confirme sua conta com o código enviado para a@b.c']))).toBeNull();
    expect(detectHumanCheck(screen('com.instagram.android', ['Username, email or mobile number', 'Password']))).toBeNull();
  });
});

describe('summarizeScreen', () => {
  it('app em frente e rótulos distintos, limitados', () => {
    const s = summarizeScreen(screen('com.microsoft.office.outlook', ['Caixa de entrada', 'Caixa de entrada', 'Instagram: código 123456', '-']), 2);
    expect(s).toBe('app: com.microsoft.office.outlook\n- Caixa de entrada\n- Instagram: código 123456');
  });
  it('sem tela → texto fixo', () => { expect(summarizeScreen(null)).toBe('(tela indisponível)'); });
  it('cabeçalho de coluna não vira rótulo', () => {
    // Verifica que o header row "node_id\tclass\ttext\t..." não é parseado como nó
    const s = summarizeScreen(screen('com.test', ['Label1', 'Label2']));
    expect(s).not.toMatch(/^- text$/m);
    expect(s).not.toMatch(/^- class$/m);
    expect(s).toMatch(/Label1/);
  });
});
