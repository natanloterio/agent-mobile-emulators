import type { ToolApprovalStatus } from 'ai';
import { allNodes, nodeById } from '../screen/checks.js';
import type { ScreenNode, ScreenState } from '../screen/parse.js';
import { toolPrefix } from './tools.js';

/** Palavras que publicam, enviam, pagam, seguem, curtem ou comprometem — casadas por palavra, em qualquer posição do rótulo. */
export const IRREVERSIBLE_LABEL =
  /\b(enviar|send|post|postar|publicar|publish|responder|reply|compartilhar|share|pagar|pay|comprar|buy|confirmar|confirm|seguir|follow|curtir|like|excluir|delete|apagar|remover|remove|bloquear|block|denunciar|report|assinar|subscribe)\b/i;

const labelOf = (n: ScreenNode) => (n.text || n.desc).trim();
const within = (inner: ScreenNode, outer: ScreenNode) =>
  inner.id !== outer.id && inner.bounds.l >= outer.bounds.l && inner.bounds.t >= outer.bounds.t && inner.bounds.r <= outer.bounds.r && inner.bounds.b <= outer.bounds.b;

/** Rótulo do nó mais os rótulos dos nós contidos nos seus bounds (proxy de descendentes; o parser descarta a hierarquia). */
function irreversibleLabelIn(node: ScreenNode, screen: ScreenState): string | null {
  const own = labelOf(node);
  if (IRREVERSIBLE_LABEL.test(own)) return own;
  for (const n of allNodes(screen)) {
    const l = labelOf(n);
    if (l && within(n, node) && IRREVERSIBLE_LABEL.test(l)) return l;
  }
  return null;
}

const deny = (reason: string): ToolApprovalStatus => ({ type: 'denied', reason: `GATE: ${reason}` });

/** Decide um toque/click por nó, olhando a última tela lida. Sem tela, nega: não se toca no que não se leu. */
export function decideNodeAction(nodeId: string, screen: ScreenState | null): ToolApprovalStatus {
  if (!screen) return deny('nenhum screen state lido antes de agir');
  const n = nodeById(screen, nodeId);
  if (!n) return deny(`nó ${nodeId} não está na última tela lida; leia a tela de novo`);
  const label = irreversibleLabelIn(n, screen);
  if (label) return deny(`toque em "${label}" é irreversível e este incremento é somente-leitura`);
  return 'approved';
}

type Approval = (input: unknown) => ToolApprovalStatus;

export function buildToolApproval(slug: string | null, lastScreen: () => ScreenState | null, mode: 'read-only'): Record<string, Approval> {
  const p = toolPrefix(slug);
  const byNode: Approval = (input) => decideNodeAction(String((input as { node_id?: unknown })?.node_id ?? ''), lastScreen());
  const noTyping: Approval = () => deny(`digitar em campo do app não é permitido em modo ${mode}; registre rascunhos no ledger`);
  return { [`${p}click_node`]: byNode, [`${p}tap_node`]: byNode, [`${p}type_append_text`]: noTyping };
}
