import type { ScreenNode, ScreenState, ScreenWindow } from './parse.js';

export function focusedWindow(s: ScreenState): ScreenWindow | null {
  return s.windows.find((w) => w.focused) ?? s.windows.find((w) => w.type === 'APPLICATION') ?? null;
}

export function allNodes(s: ScreenState): readonly ScreenNode[] {
  return s.windows.flatMap((w) => w.nodes);
}

export function nodeById(s: ScreenState, id: string): ScreenNode | null {
  return allNodes(s).find((n) => n.id === id) ?? null;
}

/** Nó editável de fato (flag `edt`), não "parece campo". Ver spec §4.5, lição 2. */
export function editableNodes(s: ScreenState): readonly ScreenNode[] {
  return allNodes(s).filter((n) => n.flags.has('edt'));
}

export function findNodes(s: ScreenState, re: RegExp): readonly ScreenNode[] {
  return allNodes(s).filter((n) => re.test(n.text) || re.test(n.desc));
}

const BLOCK_PATTERNS: readonly RegExp[] = [
  /confirme que é você/i, /confirm it's you/i, /suspicious login/i, /atividade incomum/i,
  /ajude-nos a confirmar/i, /help us confirm/i, /we suspended your account/i, /sua conta foi suspensa/i,
  /insira o código/i, /enter the code we sent/i, /captcha/i,
];

/** Texto do bloqueio de plataforma, ou null. Uma vez detectado, a identidade para (spec §6). */
export function detectPlatformBlock(s: ScreenState): string | null {
  const w = focusedWindow(s);
  if (!w || !w.pkg.startsWith('com.instagram')) return null;
  for (const n of w.nodes) {
    const hay = `${n.text} ${n.desc}`;
    if (BLOCK_PATTERNS.some((re) => re.test(hay))) return (n.text || n.desc).slice(0, 200);
  }
  return null;
}

/** Campo de usuário da tela de login do Instagram (en/pt/es), medido na conta2 deslogada em 2026-09-27. */
const LOGIN_USER = /username, email or (mobile|phone) number|nome de usu[aá]rio, e-?mail ou (n[uú]mero de )?(celular|telefone)|usuario, correo electr[oó]nico o (n[uú]mero de )?(celular|tel[eé]fono|m[oó]vil)/i;
const LOGIN_SECRET = /^(password|senha|contrase[nñ]a),?$|forgot password|esqueceu a senha|olvidaste tu contrase[nñ]a/i;

/**
 * Instagram na tela de login: a sessão da identidade caiu. Exige o campo de usuário E (senha ou "esqueci a senha"),
 * para um "Log in" solto num feed não parar a conta. Pela spec §4.1/§6: sessão inválida vira needs-human, nunca re-login automático.
 */
export function detectLoggedOut(s: ScreenState): string | null {
  const w = focusedWindow(s);
  if (!w || !w.pkg.startsWith('com.instagram')) return null;
  const labels = w.nodes.flatMap((n) => [n.text, n.desc]).map((t) => t.trim()).filter((t) => t && t !== '-');
  if (!labels.some((t) => LOGIN_USER.test(t)) || !labels.some((t) => LOGIN_SECRET.test(t))) return null;
  return 'Instagram deslogado (tela de login): faça login à mão no device e depois marque como resolvido';
}
