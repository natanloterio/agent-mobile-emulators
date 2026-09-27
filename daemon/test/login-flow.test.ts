import { describe, expect, it } from 'vitest';
import { runLogin, type LoginIo } from '../src/fleet/login.js';
import { parseScreen } from '../src/screen/parse.js';

const screen = (rows: readonly (readonly [string, string, string, string])[], pkg = 'com.instagram.android') =>
  parseScreen(`screen:1080x2400 density:420 orientation:portrait\n--- window:1 type:APPLICATION pkg:${pkg} title:Instagram layer:0 focused:true ---\nnode_id\tclass\ttext\tdesc\tres_id\tbounds\tflags\n`
    + rows.map(([id, cls, text, desc], i) => `${id}\t${cls}\t${text}\t${desc}\t-\t0,${i * 10},100,${i * 10 + 9}\t${cls === 'EditText' ? 'on,clk,foc,edt,ena' : 'on,clk,ena'}`).join('\n') + '\n');

const LOGIN = screen([['node_u', 'EditText', '-', 'Username, email or mobile number,'], ['node_p', 'EditText', '-', 'Password,'], ['node_l', 'Button', '-', 'Log in'], ['node_f', 'Button', '-', 'Forgot password?']]);
const LANDING = screen([['node_a', 'Button', '-', 'Create new account'], ['node_b', 'Button', '-', 'Log in']]);
const FEED = screen([['node_h', 'Button', '-', 'Home'], ['node_s', 'Button', '-', 'Search and explore']]);
const SAVE = screen([['node_t', 'TextView', 'Save your login info?', '-'], ['node_y', 'Button', '-', 'Save'], ['node_n', 'Button', '-', 'Not now']]);
const CHALLENGE = screen([['node_c', 'TextView', 'Enter the code we sent to your email', '-']]);
const WRONG = screen([['node_u', 'EditText', '-', 'Username, email or mobile number,'], ['node_p', 'EditText', '-', 'Password,'], ['node_e', 'TextView', 'The password you entered is incorrect.', '-'], ['node_l', 'Button', '-', 'Log in']]);

function fakeIo(screens: readonly ReturnType<typeof screen>[]) {
  const log: string[] = []; let i = 0;
  const io: LoginIo = {
    unlock: async () => { log.push('unlock'); },
    openApp: async (pkg) => { log.push(`open ${pkg}`); },
    screen: async () => screens[Math.min(i++, screens.length - 1)],
    tap: async (id) => { log.push(`tap ${id}`); },
    clear: async (id) => { log.push(`clear ${id}`); },
    type: async (id, text) => { log.push(`type ${id} ${text.replace(/./g, '*')}`); },
    sleep: async () => {},
  };
  return { io, log };
}
const creds = { username: 'papaia.me', password: 'sé nha1' };

describe('runLogin', () => {
  it('tela de login: preenche usuário e senha pelos campos, toca Log in, dispensa "salvar login" e confirma', async () => {
    const f = fakeIo([LOGIN, SAVE, FEED]);
    expect(await runLogin(f.io, creds)).toMatchObject({ outcome: 'logged-in' });
    expect(f.log).toEqual(['unlock', 'open com.instagram.android', 'clear node_u', 'type node_u *********', 'clear node_p', 'type node_p *******', 'tap node_l', 'tap node_n']);
  });
  it('tela de entrada sem campos: toca "Log in" para chegar ao formulário', async () => {
    const f = fakeIo([LANDING, LOGIN, FEED]);
    expect((await runLogin(f.io, creds)).outcome).toBe('logged-in');
    expect(f.log.slice(2, 3)).toEqual(['tap node_b']);
  });
  it('já logada: não digita nada', async () => {
    const f = fakeIo([FEED]);
    expect(await runLogin(f.io, creds)).toMatchObject({ outcome: 'already-logged-in' });
    expect(f.log.some((l) => l.startsWith('type'))).toBe(false);
  });
  it('desafio depois do Log in → needs-human, sem nova tentativa', async () => {
    const f = fakeIo([LOGIN, CHALLENGE]);
    const r = await runLogin(f.io, creds);
    expect(r).toMatchObject({ outcome: 'needs-human', detail: expect.stringMatching(/Enter the code/) });
    expect(f.log.filter((l) => l.startsWith('tap node_l'))).toHaveLength(1);
  });
  it('senha recusada → needs-human com o texto do app', async () => {
    const f = fakeIo([LOGIN, WRONG]);
    expect(await runLogin(f.io, creds)).toMatchObject({ outcome: 'needs-human', detail: expect.stringMatching(/incorrect/) });
  });
  it('continua na tela de login até o tempo acabar → needs-human', async () => {
    const f = fakeIo([LOGIN, LOGIN]);
    expect(await runLogin(f.io, creds, { timeoutMs: 3000, pollMs: 1000 })).toMatchObject({ outcome: 'needs-human', detail: expect.stringMatching(/não saiu da tela de login/) });
  });
  it('desafio já na abertura → needs-human sem digitar', async () => {
    const f = fakeIo([CHALLENGE]);
    expect((await runLogin(f.io, creds)).outcome).toBe('needs-human');
    expect(f.log.some((l) => l.startsWith('type'))).toBe(false);
  });
});
