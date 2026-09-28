/** Um nó do `uiautomator dump`: só o que o daemon usa para achar e tocar em algo sem modelo de linguagem. */
export interface UiNode {
  readonly text: string; readonly resourceId: string; readonly contentDesc: string; readonly className: string;
  readonly bounds: readonly [number, number, number, number];
}

const attr = (tag: string, name: string): string => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&') : '';
};

export function parseUiDump(xml: string): readonly UiNode[] {
  const out: UiNode[] = [];
  for (const m of xml.matchAll(/<node\b[^>]*>/g)) {
    const tag = m[0];
    const b = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(attr(tag, 'bounds'));
    if (!b) continue;
    out.push({
      text: attr(tag, 'text'), resourceId: attr(tag, 'resource-id'), contentDesc: attr(tag, 'content-desc'), className: attr(tag, 'class'),
      bounds: [Number(b[1]), Number(b[2]), Number(b[3]), Number(b[4])],
    });
  }
  return out;
}

export const findNode = (nodes: readonly UiNode[], pred: (n: UiNode) => boolean): UiNode | null => nodes.find(pred) ?? null;

export const center = (n: UiNode): readonly [number, number] =>
  [Math.round((n.bounds[0] + n.bounds[2]) / 2), Math.round((n.bounds[1] + n.bounds[3]) / 2)];
