import type { ToolApprovalStatus } from 'ai';
import { nodeById } from '../screen/checks.js';
import type { ScreenState } from '../screen/parse.js';
import { toolPrefix } from './tools.js';

/** Rótulos que publicam, enviam, pagam ou comprometem — irreversíveis para terceiros. */
export const IRREVERSIBLE_LABEL =
  /^(enviar|send|post|publicar|postar|responder|reply|compartilhar|share|pagar|pay|comprar|buy|confirmar|confirm|seguir|follow|excluir|delete|apagar|remover|remove|bloquear|block|denunciar|report)$/i;

const deny = (reason: string): ToolApprovalStatus => ({ type: 'denied', reason: `GATE: ${reason}` });

/** Decide um toque/click por nó, olhando a última tela lida. Sem tela, nega: não se toca no que não se leu. */
export function decideNodeAction(nodeId: string, screen: ScreenState | null): ToolApprovalStatus {
  if (!screen) return deny('nenhum screen state lido antes de agir');
  const n = nodeById(screen, nodeId);
  if (!n) return deny(`nó ${nodeId} não está na última tela lida; leia a tela de novo`);
  const label = (n.text || n.desc).trim();
  if (IRREVERSIBLE_LABEL.test(label)) return deny(`toque em "${label}" é irreversível e este incremento é somente-leitura`);
  return 'approved';
}

type Approval = (input: unknown) => ToolApprovalStatus;

export function buildToolApproval(slug: string | null, lastScreen: () => ScreenState | null, mode: 'read-only'): Record<string, Approval> {
  const p = toolPrefix(slug);
  const byNode: Approval = (input) => decideNodeAction(String((input as { node_id?: unknown })?.node_id ?? ''), lastScreen());
  const noTyping: Approval = () => deny(`digitar em campo do app não é permitido em modo ${mode}; registre rascunhos no ledger`);
  return { [`${p}click_node`]: byNode, [`${p}tap_node`]: byNode, [`${p}type_append_text`]: noTyping };
}
