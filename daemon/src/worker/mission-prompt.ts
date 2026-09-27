import type { ToolSet } from 'ai';
import type { MemoryRow } from '../db/missions.js';
import { toolPrefix, WORKER_TOOL_SUFFIXES } from './tools.js';

export const MISSION_SYSTEM_PROMPT = `Você opera UM celular Android por ferramentas e está cumprindo uma subtarefa de uma missão maior.
Você pode abrir qualquer app, o navegador ou a Play Store, digitar em campos e tocar em qualquer botão (inclusive Confirmar, Cadastrar, Próximo).
Regras:
1. Leia a tela com get_screen_state antes de agir e de novo depois de cada ação.
2. Senha: nunca invente nem digite senha em texto. Crie com secret_new(key) e digite com type_secret(node_id, key).
3. Guarde com memory_put tudo que as próximas subtarefas vão precisar (endereço de e-mail, onde ler a caixa, nome de usuário criado).
4. Conta criada num app: guarde account.<pacote>.username com memory_put e a senha em account.<pacote>.password com secret_new.
5. Código de confirmação enviado para um e-mail desta missão: abra a caixa, leia o código e digite-o.
6. Captcha, "confirme que é você", código enviado por SMS/telefone ou pedido de número de telefone: chame request_human explicando o que falta. Não tente contornar verificação de forma alguma, nem por sites de terceiros.
7. Se um caminho falhar, tente outro razoável dentro da subtarefa; se não houver, encerre com finish_subtask(ok=false) explicando o que atrapalhou.
Sempre termine com finish_subtask.`;

export const MISSION_ESCALATION_NOTE = (n: number, model: string): string =>
  `Continuação: o modelo anterior (${model}) falhou ${n} vezes ao chamar tools com argumentos válidos e foi substituído por você. ` +
  'Continue a mesma subtarefa de onde a última tela parou. Leia a tela antes de agir. Termine com finish_subtask.';

/** Mensagem do usuário da subtarefa: missão, objetivo, critério e memória (segredos só pela chave). */
export function missionInstruction(i: { objective: string; successCriteria: string; memory: readonly MemoryRow[]; missionText: string }): string {
  const mem = i.memory.length ? i.memory.map((m) => `- ${m.key}: ${m.secret ? '(segredo no cofre; use type_secret)' : m.value}`).join('\n') : '(vazia)';
  return `Missão: ${i.missionText}\nSubtarefa: ${i.objective}\nCritério de sucesso: ${i.successCriteria}\nMemória da missão:\n${mem}`;
}

/** Tools extras de digitação e gesto que a missão usa além das 11 do worker (filtradas pelo que o MCP tiver). */
const MISSION_EXTRA_SUFFIXES = ['type_clear_text', 'type_replace_text', 'press_key', 'swipe', 'long_press'] as const;

export function pickMissionTools(all: ToolSet, slug: string | null): ToolSet {
  const prefix = toolPrefix(slug);
  const wanted = new Set([...WORKER_TOOL_SUFFIXES, ...MISSION_EXTRA_SUFFIXES].map((s) => prefix + s));
  return Object.fromEntries(Object.entries(all).filter(([name]) => wanted.has(name)));
}
