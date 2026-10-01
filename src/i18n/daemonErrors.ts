import type { MessageKey } from './messages';
import type { Params, T } from './translate';

interface Rule { readonly re: RegExp; readonly key: MessageKey; readonly params?: (m: RegExpExecArray) => Params }

/**
 * Mensagens do daemon (em português, é a língua do código dele) que chegam à tela. Cada uma vira texto no idioma da
 * tela, com os parâmetros tirados da própria mensagem. Fora da lista, a mensagem passa como veio.
 */
const RULES: readonly Rule[] = [
  { re: /^nenhuma identidade livre para o tool-call/, key: 'common.err.noFreeIdentity' },
  { re: /^(\S+) não pronta: (.*)$/s, key: 'common.err.notReady', params: (m) => ({ name: m[1], detail: m[2] }) },
  { re: /^AVD-base (\S+) em uso \(([^)]+)\)/, key: 'common.err.baseInUse', params: (m) => ({ name: m[1], serial: m[2] }) },
  { re: /^o celular-base ainda está sendo preparado/, key: 'common.err.basePreparing' },
  { re: /^kill switch acionado/, key: 'common.err.killed' },
  { re: /^identidade rodando um objetivo/, key: 'common.err.goalRunning' },
  { re: /^identidade já tem uma missão aberta/, key: 'common.err.missionOpen' },
  { re: /^identidade sob controle humano/, key: 'common.err.controlled' },
  { re: /^identidade pausada/, key: 'common.err.paused' },
  { re: /^emulador fora do adb/, key: 'common.err.noAdb' },
  { re: /^emulador (\S+) não completou o boot em (\d+) s/, key: 'common.err.bootTimeout', params: (m) => ({ name: m[1], s: m[2] }) },
  { re: /^emulador (\S+) saiu antes do boot; veja (.+)$/s, key: 'common.err.bootExited', params: (m) => ({ name: m[1], log: m[2] }) },
  { re: /^clone do AVD falhou: (.*)$/s, key: 'common.err.cloneFailed', params: (m) => ({ detail: m[1] }) },
  { re: /^sem porta de console livre/, key: 'common.err.noPorts' },
  { re: /^(.+?) parado — o próximo teste ou objetivo o sobe$/, key: 'providers.runtime.stopped', params: (m) => ({ runtime: m[1] }) },
  { re: /^daemon não conectado/, key: 'common.err.daemonDown' },
  { re: /^o preparo foi interrompido/, key: 'common.err.prepInterrupted' },
  { re: /^a missão terminou sem o app instalado/, key: 'common.err.noApp' },
  { re: /^a missão de instalar o app foi abandonada/, key: 'common.err.missionAbandoned' },
  { re: /^a conta Google continua no celular-base/, key: 'common.err.googleLeft' },
  { re: /^o celular-base recusou o adb/, key: 'common.err.adbRefused' },
  { re: /^o download do app MCP parou/, key: 'common.err.downloadStalled' },
  { re: /^download do app MCP falhou \(HTTP (\d+)\)/, key: 'common.err.downloadHttp', params: (m) => ({ status: m[1] }) },
  { re: /^app MCP baixado não confere/, key: 'common.err.apkMismatch' },
  { re: /^avdmanager (?:falhou|terminou)(.*)$/s, key: 'common.err.avdmanager', params: (m) => ({ detail: m[1].replace(/^[\s(:\d)]*/, '').trim() }) },
  { re: /^o servidor MCP do celular-base não respondeu/, key: 'common.err.mcpNoAnswer' },
  { re: /^o emulador do celular-base não fechou/, key: 'common.err.emuNotClosed' },
  { re: /^já existe uma identidade sua chamada base/, key: 'common.err.baseNameTaken' },
  { re: /^PIN recusado/, key: 'common.err.pinRefused' },
  { re: /^sem credenciais salvas para esta identidade/, key: 'common.err.noCreds' },
  { re: /^identidade (\S+) já existe/, key: 'common.err.identityExists', params: (m) => ({ name: m[1] }) },
  { re: /^nome base é reservado/, key: 'common.err.reservedName' },
  { re: /^Instagram deslogado \(tela de login\)/, key: 'common.err.loggedOut' },
  { re: /^o Instagram ainda está na tela de login/, key: 'common.err.stillLoggedOut' },
  { re: /^o Instagram pediu uma verificação: (.*)$/s, key: 'common.err.appCheck', params: (m) => ({ detail: m[1] }) },
  { re: /^(?:o Instagram não abriu no celular|não deu para ver o Instagram logado no celular)/, key: 'common.err.appNotOpen' },
  { re: /^(?:não deu para conferir o login no celular: )?device não pronto para o login/, key: 'common.err.controlAppDown' },
  { re: /^não deu para conferir o login no celular: (.*)$/s, key: 'common.err.cantCheck', params: (m) => ({ detail: m[1] }) },
];

/** Tira o envelope que o main põe nas respostas de erro (`/rota → 409: {"error": …}`); lista de erros vira uma linha. */
export function unwrapDaemonError(raw: string): string {
  // Com o envelope do main, ou só o corpo `{"error": …}` (o bridgeMessage das ações já tira o prefixo da rota).
  const m = /^\/\S* → \d{3}: (.*)$/s.exec(raw.trim()) ?? (/^\{.*\}$/s.test(raw.trim()) ? [raw, raw.trim()] as const : null);
  if (!m) return raw.trim();
  try {
    const e = (JSON.parse(m[1]) as { error?: unknown })?.error;
    if (Array.isArray(e)) return e.map(String).join('; ');
    return typeof e === 'string' ? e : raw.trim();
  } catch { return raw.trim(); }
}

export function daemonErrorText(raw: string, t: T): string {
  const msg = unwrapDaemonError(raw);
  for (const r of RULES) {
    const m = r.re.exec(msg);
    if (m) return t(r.key, r.params?.(m));
  }
  return msg;
}
