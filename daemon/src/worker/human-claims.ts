/**
 * Conferência do request_human (missões): o executor local às vezes pede uma pessoa por um motivo falso ("não está
 * logado" com a conta logada) ou por algo que o daemon faz ("aperte volume + power para um print"). Medido numa missão
 * de 2026-09-30 que parou três vezes assim. Só recusa o que dá para conferir; na dúvida, a pessoa decide.
 */
export type HumanClaim = 'login' | 'screenshot' | 'guidance' | null;

const SCREENSHOT = /screenshot|print (?:d[ae] )?tela|print(?:ar)? (?:o |a )?(?:post|tela)|captur\w* (?:a |da )?tela|capture the screen|volume|power button|bot(?:ão|ao|ões|oes) (?:de )?(?:ligar|volume|power)/i;
/** Pedido de orientação ("o que faço agora?"): não é trabalho de pessoa, a menos que cite uma verificação de verdade. */
const GUIDANCE = /clarif|guide (?:me|the next|next)|next steps|what should i|how (?:should|to) proceed|orienta[çc][ãa]o|o que (?:devo )?fazer|como (?:devo )?(?:seguir|proceder)|n[ãa]o sei (?:o que|como)/i;
const VERIFICATION = /captcha|c[óo]digo|code|sms|telefone|phone|confirm|verifica/i;
const LOGIN = /\blog(?:ged)?[ -]?in(?:to)?\b|\blogin\b|logad|deslog|sign(?:ed)?[ -]in|autentica|authenticat|entrar na conta/i;

export function classifyHumanReason(reason: string): HumanClaim {
  if (SCREENSHOT.test(reason)) return 'screenshot';
  if (LOGIN.test(reason)) return 'login';
  if (GUIDANCE.test(reason) && !VERIFICATION.test(reason)) return 'guidance';
  return null;
}

export interface HumanClaimDeps {
  /** Lê a tela do Instagram da identidade (fleet/login.ts `checkSession`). */
  readonly session: () => Promise<'logged-in' | 'logged-out' | 'blocked' | 'unknown'>;
  /** A tool screen_capture está disponível nesta missão. */
  readonly canCapture: boolean;
}

export const REFUSE_LOGGED_IN = 'Conferido na tela agora: o Instagram está logado nesta conta. Não é preciso login; continue a subtarefa.';
export const REFUSE_SCREENSHOT = 'Não peça botões físicos nem prints à pessoa: use screen_capture (o daemon tira a captura, pode recortar pelo bounds do post e ela vai para a galeria).';

export const REFUSE_GUIDANCE = 'Pedir orientação não é tarefa de pessoa. Leia a tela de novo (get_screen_state) e decida; se o que a subtarefa pede não existe na tela, encerre com finish_subtask(ok=false) contando o que viu, e o planejador escolhe outro caminho.';

/** Devolve o motivo da recusa (volta ao modelo como resultado da tool) ou null para deixar o pedido seguir. */
export function createHumanClaimCheck(d: HumanClaimDeps): (reason: string) => Promise<string | null> {
  return async (reason) => {
    const kind = classifyHumanReason(reason);
    if (kind === 'screenshot') return d.canCapture ? REFUSE_SCREENSHOT : null;
    if (kind === 'guidance') return REFUSE_GUIDANCE;
    if (kind !== 'login') return null;
    try { return (await d.session()) === 'logged-in' ? REFUSE_LOGGED_IN : null; } catch { return null; }
  };
}
