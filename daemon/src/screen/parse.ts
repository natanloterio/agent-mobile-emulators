export interface Bounds { readonly l: number; readonly t: number; readonly r: number; readonly b: number }
export interface ScreenNode {
  readonly id: string; readonly cls: string; readonly text: string; readonly desc: string; readonly resId: string;
  readonly bounds: Bounds; readonly flags: ReadonlySet<string>;
}
export interface ScreenWindow {
  readonly pkg: string; readonly type: string; readonly focused: boolean; readonly title: string; readonly nodes: readonly ScreenNode[];
}
export interface ScreenState {
  readonly width: number; readonly height: number; readonly cursor: string | null; readonly windows: readonly ScreenWindow[];
}

const WINDOW_RE = /^--- window:\S+ type:(\S+) pkg:(\S+)(?: title:(.*?))?(?: activity:\S+)? layer:\S+ focused:(true|false) ---$/;
const SCREEN_RE = /^screen:(\d+)x(\d+)/;
const CURSOR_RE = /^(?:next_)?cursor:(\S+)/;

function parseNodeLine(line: string): ScreenNode | null {
  const c = line.split('\t');
  if (c.length < 7 || !c[0].startsWith('node_')) return null;
  const [l, t, r, b] = c[5].split(',').map(Number);
  return {
    id: c[0], cls: c[1], text: c[2] === '-' ? '' : c[2], desc: c[3] === '-' ? '' : c[3], resId: c[4] === '-' ? '' : c[4],
    bounds: { l, t, r, b }, flags: new Set(c[6].split(',').map((f) => f.trim()).filter(Boolean)),
  };
}

export function parseScreen(text: string): ScreenState {
  let width = 0; let height = 0; let cursor: string | null = null;
  const windows: ScreenWindow[] = [];
  let current: { pkg: string; type: string; focused: boolean; title: string; nodes: ScreenNode[] } | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const sm = SCREEN_RE.exec(line);
    if (sm) { width = Number(sm[1]); height = Number(sm[2]); continue; }
    const cm = CURSOR_RE.exec(line);
    if (cm) { cursor = cm[1]; continue; }
    const wm = WINDOW_RE.exec(line);
    if (wm) {
      if (current) windows.push({ ...current, nodes: [...current.nodes] });
      current = { type: wm[1], pkg: wm[2], title: wm[3] ?? '', focused: wm[4] === 'true', nodes: [] };
      continue;
    }
    if (line === 'hierarchy:') continue;
    const node = parseNodeLine(line);
    if (node && current) current.nodes.push(node);
  }
  if (current) windows.push({ ...current, nodes: [...current.nodes] });
  return { width, height, cursor, windows };
}
