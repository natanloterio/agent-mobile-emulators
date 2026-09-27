import { focusedWindow } from './checks.js';
import type { ScreenState } from './parse.js';

/**
 * Verificações que só um humano resolve, em qualquer app (spec missões §Detecção). Diferente de `detectPlatformBlock`:
 * "insira o código" e "confirme sua conta" soltos NÃO entram — código enviado ao e-mail da própria missão o agente lê.
 */
const HUMAN_PATTERNS: readonly RegExp[] = [
  // Texto de desafio, não a palavra "captcha" solta: o selo do reCAPTCHA v3 ("protected by reCAPTCHA") não é desafio.
  /i'?m not a robot/i, /n[aã]o sou um rob[oô]/i, /no soy un robot/i,
  /select all (the )?images/i, /selecione todas as imagens/i,
  /verify (that )?you are (a )?human/i, /verifique se voc[eê] [ée] humano/i,
  /hcaptcha/i, /solve (this|the) (puzzle|captcha)/i, /digite os caracteres/i, /type the characters/i,
  /confirme que [ée] voc[eê]/i, /confirm it'?s you/i, /help us confirm/i, /ajude-nos a confirmar/i,
  /suspicious login/i, /atividade incomum/i,
  /we suspended your account/i, /sua conta foi suspensa/i,
  /choose a way to confirm/i, /escolha (uma )?forma de confirmar/i, /elige una forma de confirmar/i,
];

export function detectHumanCheck(s: ScreenState): string | null {
  const w = focusedWindow(s);
  if (!w) return null;
  for (const n of w.nodes) {
    const hay = `${n.text} ${n.desc}`;
    if (HUMAN_PATTERNS.some((re) => re.test(hay))) return (n.text || n.desc).slice(0, 200);
  }
  return null;
}

/** Resumo curto para o planejador: pacote em frente e até `max` rótulos distintos da janela focada. */
export function summarizeScreen(s: ScreenState | null, max = 40): string {
  if (!s) return '(tela indisponível)';
  const w = focusedWindow(s);
  if (!w) return '(sem janela em foco)';
  const labels = [...new Set(w.nodes.map((n) => (n.text || n.desc).trim()).filter((l) => l && l !== '-'))].slice(0, max);
  return [`app: ${w.pkg}`, ...labels.map((l) => `- ${l.slice(0, 120)}`)].join('\n');
}
