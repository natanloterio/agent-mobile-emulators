import { describe, expect, it } from 'vitest';
import { detectLoggedOut } from '../src/screen/checks.js';
import { parseScreen } from '../src/screen/parse.js';

const screen = (rows: readonly (readonly [string, string, string, string])[], pkg = 'com.instagram.android') =>
  parseScreen(`screen:1080x2400 density:420 orientation:portrait\n--- window:1 type:APPLICATION pkg:${pkg} title:Instagram layer:0 focused:true ---\nnode_id\tclass\ttext\tdesc\tres_id\tbounds\tflags\n`
    + rows.map(([id, cls, text, desc], i) => `${id}\t${cls}\t${text}\t${desc}\t-\t0,${i * 10},100,${i * 10 + 9}\t${cls === 'EditText' ? 'on,clk,foc,edt,ena' : 'on,clk,ena'}`).join('\n') + '\n');

// Textos medidos na conta2 deslogada (Instagram 448, 2026-09-27).
const LOGIN_EN = screen([
  ['node_1', 'Button', 'English (US)', 'English (US)'], ['node_2', 'ImageView', '-', 'Instagram from Meta'],
  ['node_3', 'EditText', '-', 'Username, email or mobile number,'], ['node_4', 'EditText', '-', 'Password,'],
  ['node_5', 'Button', '-', 'Log in'], ['node_6', 'Button', '-', 'Forgot password?'], ['node_7', 'Button', '-', 'Create new account'],
]);
const LOGIN_PT = screen([
  ['node_3', 'EditText', '-', 'Nome de usuário, email ou número de celular,'], ['node_4', 'EditText', '-', 'Senha,'],
  ['node_5', 'Button', '-', 'Entrar'], ['node_6', 'Button', '-', 'Esqueceu a senha?'],
]);

describe('detectLoggedOut', () => {
  it('tela de login do Instagram em inglês e em português', () => {
    expect(detectLoggedOut(LOGIN_EN)).toMatch(/deslogad/);
    expect(detectLoggedOut(LOGIN_PT)).toMatch(/deslogad/);
  });
  it('"Log in" solto num feed não dispara; nem tela de login de outro app', () => {
    expect(detectLoggedOut(screen([['node_1', 'TextView', 'Log in to see more', '-'], ['node_2', 'Button', '-', 'Home']]))).toBeNull();
    expect(detectLoggedOut(screen([['node_3', 'EditText', '-', 'Username, email or mobile number,'], ['node_4', 'EditText', '-', 'Password,']], 'com.android.chrome'))).toBeNull();
  });
});
