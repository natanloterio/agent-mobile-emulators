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
 * Sinais positivos da conta aberta: as abas de baixo do Instagram, pelo id do recurso (independe do idioma) ou pelo
 * rótulo (en/pt/es). Ausência de formulário de login não basta: lida cedo demais, a tela de carregamento do app não tem
 * campo nenhum e passava por logada (medido em 2026-10-01: "Entrei" aceito e, segundos depois, recusado no mesmo device).
 */
const TAB_ID = /:id\/(?:tab_bar|feed_tab|search_tab|clips_tab|direct_tab|creation_tab|profile_tab)$/;
const TAB_LABEL = /^(?:home|search and explore|reels|profile|create|p[aá]gina inicial|pesquisar e explorar|perfil|criar|inicio|buscar y explorar|crear)$/i;
function showsTabs(s: ScreenState): boolean {
  const ns = nodes(s);
  if (ns.some((n) => TAB_ID.test(n.resId))) return true;
  return new Set(ns.map((n) => label(n).toLowerCase()).filter((t) => TAB_LABEL.test(t))).size >= 2;
}

/**
 * Abre o Instagram e só lê a tela, esperando ela assentar: verificação na frente → `blocked` (com o texto do app);
 * formulário ou tela de entrada → `logged-out`; abas do app visíveis, ou o app firme fora da tela de login por várias
 * leituras → `logged-in`; nada disso até o fim das tentativas (outro app na frente) → `unknown`. Nunca toca em nada.
 */
export async function checkSession(io: LoginIo, opts: { tries?: number; pollMs?: number; stable?: number } = {}): Promise<SessionCheck> {
  await io.unlock();
  await io.openApp(INSTAGRAM);
  let last: ScreenState | null = null; let calm = 0;
  for (let i = 0; i < (opts.tries ?? 6); i++) {
    await io.sleep(i === 0 ? 2_500 : opts.pollMs ?? 2_000);
    const s = await io.screen(); last = s;
    const block = detectPlatformBlock(s);
    if (block) return { state: 'blocked', detail: block };
    if (!inInstagram(s)) { calm = 0; continue; }
    if (detectLoggedOut(s) || find(s, ENTRY_BUTTON, false)) return { state: 'logged-out', detail: '' };
    if (showsTabs(s)) return { state: 'logged-in', detail: '' };
    // Sem as abas (rótulos/ids não conferidos num Instagram logado de verdade): várias leituras seguidas no app, fora da
    // tela de login, também valem. Uma tela de carregamento não dura tanto; uma leitura só, cedo demais, não vale mais.
    if (++calm >= (opts.stable ?? 4)) return { state: 'logged-in', detail: '' };
  }
  return { state: 'unknown', detail: last && !inInstagram(last) ? focusedWindow(last)?.pkg ?? '' : 'carregando' };
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
