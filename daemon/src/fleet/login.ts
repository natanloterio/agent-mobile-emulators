import { detectLoggedOut, detectPlatformBlock, focusedWindow } from '../screen/checks.js';
import type { ScreenNode, ScreenState } from '../screen/parse.js';

/** Resultado do login (spec login-deterministico §Contrato). */
export interface LoginResult { readonly outcome: 'logged-in' | 'already-logged-in' | 'needs-human'; readonly detail: string }
export interface Credentials { readonly username: string; readonly password: string }

/** Ações no device usadas pelo roteiro; em produção, ferramentas do MCP da identidade (nenhuma passa pelo LLM). */
export interface LoginIo {
  unlock(): Promise<unknown>;
  openApp(pkg: string): Promise<void>;
  screen(): Promise<ScreenState>;
  tap(nodeId: string): Promise<void>;
  clear(nodeId: string): Promise<void>;
  type(nodeId: string, text: string): Promise<void>;
  sleep(ms: number): Promise<void>;
}

const INSTAGRAM = 'com.instagram.android';
const USER_FIELD = /username, email or (mobile|phone) number|nome de usu[aá]rio, e-?mail ou (n[uú]mero de )?(celular|telefone)|usuario, correo electr[oó]nico o (n[uú]mero de )?(celular|tel[eé]fono|m[oó]vil)/i;
const PASS_FIELD = /^(password|senha|contrase[nñ]a),?$/i;
const LOGIN_BUTTON = /^(log in|entrar|iniciar sesi[oó]n)$/i;
/** Telas antes do formulário ("tenho uma conta", "entrar em outra conta"). */
const ENTRY_BUTTON = /^(log in|entrar|iniciar sesi[oó]n|i already have an account|j[aá] tenho uma conta|ya tengo una cuenta|log in(to)? (an)?other account|entrar em outra conta)$/i;
const NOT_NOW = /^(not now|agora n[aã]o|ahora no)$/i;
/** Diálogo do Android oferecendo guardar a senha no gerenciador do Google: sempre recusado. */
const SAVE_PASSWORD = /save password to google|salvar (a )?senha no (gerenciador|google)|guardar (la )?contrase[nñ]a en/i;
const REFUSED = /incorrect|incorret[ao]|incorrect[ao]|n[aã]o (encontramos|pertence)|couldn'?t find|doesn'?t belong|no pertenece|try again later|tente novamente mais tarde/i;

const label = (n: ScreenNode) => (n.text || n.desc).trim();
const nodes = (s: ScreenState) => focusedWindow(s)?.nodes ?? [];
const find = (s: ScreenState, re: RegExp, editable?: boolean) =>
  nodes(s).find((n) => re.test(label(n)) && (editable === undefined || n.flags.has('edt') === editable)) ?? null;
const inInstagram = (s: ScreenState) => !!focusedWindow(s)?.pkg.startsWith('com.instagram');

/** Estado da sessão do Instagram lido na tela, sem modelo e sem tocar em nada (spec guia: "Entrei" conferido). */
export interface SessionCheck { readonly state: 'logged-in' | 'logged-out' | 'blocked' | 'unknown'; readonly detail: string }

/**
 * Abre o Instagram e só lê a tela: verificação na frente → `blocked` (com o texto do app); formulário ou tela de
 * entrada → `logged-out`; qualquer outra tela do Instagram → `logged-in`; outro app na frente → `unknown`.
 */
export async function checkSession(io: LoginIo): Promise<SessionCheck> {
  await io.unlock();
  await io.openApp(INSTAGRAM);
  await io.sleep(2_500);
  const s = await io.screen();
  const block = detectPlatformBlock(s);
  if (block) return { state: 'blocked', detail: block };
  if (!inInstagram(s)) return { state: 'unknown', detail: focusedWindow(s)?.pkg ?? '' };
  if (detectLoggedOut(s) || find(s, ENTRY_BUTTON, false)) return { state: 'logged-out', detail: '' };
  return { state: 'logged-in', detail: '' };
}

/**
 * Login fixo do Instagram, sem modelo: uma tentativa por chamada. Qualquer desafio ou recusa → needs-human (spec §6: nunca
 * retry em bloqueio). A senha só vai para `io.type` — nunca para resultado, log ou erro.
 */
export async function runLogin(io: LoginIo, creds: Credentials, opts: { timeoutMs?: number; pollMs?: number } = {}): Promise<LoginResult> {
  const timeoutMs = opts.timeoutMs ?? 45_000; const pollMs = opts.pollMs ?? 3_000;
  await io.unlock();
  await io.openApp(INSTAGRAM);
  await io.sleep(2_500);

  let s = await io.screen();
  for (let hop = 0; hop < 3; hop++) {
    const block = detectPlatformBlock(s);
    if (block) return { outcome: 'needs-human', detail: `Instagram pediu verificação antes do login: ${block}` };
    if (detectLoggedOut(s)) break;
    const entry = inInstagram(s) ? find(s, ENTRY_BUTTON, false) : null;
    // Sem formulário e sem botão de entrada, no Instagram: a sessão já está de pé.
    if (!entry) return inInstagram(s) ? { outcome: 'already-logged-in', detail: 'o Instagram abriu direto na conta' } : { outcome: 'needs-human', detail: 'o Instagram não abriu na tela esperada' };
    await io.tap(entry.id); await io.sleep(2_000);
    s = await io.screen();
  }
  const user = find(s, USER_FIELD, true); const pass = find(s, PASS_FIELD, true); const button = find(s, LOGIN_BUTTON, false);
  if (!user || !pass || !button) return { outcome: 'needs-human', detail: 'tela de login sem os campos esperados (o app pode ter mudado)' };

  await io.clear(user.id); await io.type(user.id, creds.username);
  await io.clear(pass.id); await io.type(pass.id, creds.password);
  await io.tap(button.id);

  for (let waited = 0; waited < timeoutMs; waited += pollMs) {
    await io.sleep(pollMs);
    const now = await io.screen();
    const block = detectPlatformBlock(now);
    if (block) return { outcome: 'needs-human', detail: `Instagram pediu verificação: ${block}` };
    const refused = nodes(now).find((n) => REFUSED.test(label(n)));
    if (refused) return { outcome: 'needs-human', detail: `login recusado pelo Instagram: ${label(refused).slice(0, 160)}` };
    if (detectLoggedOut(now)) continue; // ainda carregando na mesma tela
    // Oferta de guardar a senha (fora do Instagram): recusa e olha de novo o que está por trás.
    if (nodes(now).some((n) => SAVE_PASSWORD.test(label(n)))) {
      const no = find(now, NOT_NOW, false);
      if (no) { await io.tap(no.id); await io.sleep(1_500); }
      continue;
    }
    // Sucesso só com o próprio Instagram na frente, fora da tela de login e sem desafio.
    if (!inInstagram(now)) continue;
    const later = find(now, NOT_NOW, false);
    if (later) { await io.tap(later.id); await io.sleep(1_500); }
    return { outcome: 'logged-in', detail: 'login feito pelo daemon' };
  }
  return { outcome: 'needs-human', detail: `o Instagram não saiu da tela de login em ${Math.round(timeoutMs / 1000)} s` };
}
