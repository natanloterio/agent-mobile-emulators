import type { ToolSet } from 'ai';

/** As 11 tools do fluxo de comentários (spec §4.3, subset −78%). Nomes sem prefixo. */
export const WORKER_TOOL_SUFFIXES = [
  'get_screen_state', 'get_node_details', 'find_nodes', 'click_node', 'tap_node', 'scroll', 'scroll_to_node',
  'wait_for_node', 'type_append_text', 'press_back', 'open_app',
] as const;

export function toolPrefix(slug: string | null): string {
  return slug ? `android_${slug}_` : 'android_';
}

export function pickWorkerTools(all: ToolSet, slug: string | null): ToolSet {
  const prefix = toolPrefix(slug);
  const wanted = new Set(WORKER_TOOL_SUFFIXES.map((s) => prefix + s));
  return Object.fromEntries(Object.entries(all).filter(([name]) => wanted.has(name)));
}

export function missingWorkerTools(all: ToolSet, slug: string | null): readonly string[] {
  const prefix = toolPrefix(slug);
  return WORKER_TOOL_SUFFIXES.map((s) => prefix + s).filter((name) => !(name in all));
}
