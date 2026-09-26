export const SYSTEM_PROMPT = `Você opera UM celular Android por ferramentas. O app alvo é o Instagram, já logado.
Regras invioláveis:
1. Leia a tela com get_screen_state antes de qualquer ação, e de novo depois de cada ação.
2. Este turno é SOMENTE LEITURA: nunca toque em Enviar/Publicar/Postar/Responder/Compartilhar/Seguir/Pagar. Um gate vai negar; se negar, não insista.
3. Não digite em campos do app. Rascunhos vão para a ferramenta ledger_record.
4. Antes de tratar um item (comentário, DM, menção, story…), chame ledger_record; se ela responder already=true, pule o item.
5. Se aparecer "Confirme que é você", captcha, ou pedido de código, pare imediatamente e diga o que viu.
6. Seja econômico: use find_nodes e get_node_details em vez de reler a tela inteira quando bastar.
Ao terminar, responda com um resumo curto: itens encontrados, itens já tratados, rascunhos propostos.`;

const COMMENTS = /coment/i;

/** Roteiro por workload: comentários têm o fluxo medido; o resto recebe um roteiro genérico com a mesma disciplina de ledger. */
export function taskInstruction(goalText: string): string {
  if (COMMENTS.test(goalText)) return `Objetivo: ${goalText}
Passos esperados: abrir o Instagram (open_app com com.instagram.android), ir para a aba de atividade/notificações, localizar até 5 comentários recentes ainda sem resposta nas publicações desta conta, e para cada um chamar ledger_record com item_key "comment:<autor>:<8 primeiros chars do texto>", o autor, o trecho e um rascunho de resposta curta e cordial em português. Não envie nada.`;
  return `Objetivo: ${goalText}
Passos esperados: abrir o Instagram (open_app com com.instagram.android), navegar até a área do app onde esse objetivo se resolve, localizar até 5 itens pertinentes a esta conta, e para cada um chamar ledger_record com item_key "<tipo>:<autor ou origem>:<8 primeiros chars do texto>" (tipo curto em inglês, ex.: dm, mention, story), o autor, o trecho e, quando couber, um rascunho de resposta curta e cordial em português (senão uma nota do que precisa ser feito). Não envie nada.`;
}

/** Mensagem que abre o segmento 2 (spec §5): o histórico não traz as tool calls inválidas (o SDK as descarta). */
export const ESCALATION_NOTE = (n: number, model: string): string =>
  `Continuação: o modelo anterior (${model}) falhou ${n} vezes ao chamar tools com argumentos válidos e foi substituído por você. ` +
  `Continue a mesma tarefa de onde a última tela parou. Leia a tela antes de agir. As regras de somente-leitura continuam valendo.`;
