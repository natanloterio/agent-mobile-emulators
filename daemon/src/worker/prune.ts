import type { ModelMessage } from 'ai';

export const PRUNED_PLACEHOLDER = '[estado de tela podado — chame get_screen_state para ver a tela atual]';

export function isScreenTool(name: string): boolean {
  return /^android_(?:[a-z0-9]+_)?get_screen_state$/.test(name);
}

type ToolPart = { type: string; toolCallId?: string; toolName?: string; output?: { type: string; value?: unknown } };

/** Mantém os `keep` últimos resultados de get_screen_state; os anteriores viram placeholder. Nunca muta a entrada. */
export function pruneScreens(messages: readonly ModelMessage[], keep: number): ModelMessage[] {
  const screenIds: string[] = [];
  for (const m of messages) {
    if (m.role !== 'tool') continue;
    for (const part of m.content as readonly ToolPart[]) {
      if (part.type === 'tool-result' && part.toolName && isScreenTool(part.toolName) && part.toolCallId) screenIds.push(part.toolCallId);
    }
  }
  const stale = new Set(screenIds.slice(0, Math.max(0, screenIds.length - keep)));
  if (stale.size === 0) return [...messages];
  return messages.map((m) => {
    if (m.role !== 'tool') return m;
    const content = (m.content as readonly ToolPart[]).map((part) =>
      part.type === 'tool-result' && part.toolCallId && stale.has(part.toolCallId)
        ? { ...part, output: { type: 'text', value: PRUNED_PLACEHOLDER } }
        : part,
    );
    return { ...m, content } as ModelMessage;
  });
}
