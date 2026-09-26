/** Parser/serializer de .ini do AVD (`chave=valor` por linha). Preserva ordem, comentários e espaços; nunca muta a entrada. */
export interface IniLine { readonly raw: string; readonly key: string | null; readonly value: string | null }

export function parseIni(text: string): readonly IniLine[] {
  return text.split('\n').map((raw) => {
    const eq = raw.indexOf('=');
    if (eq <= 0 || /^\s*[#;]/.test(raw)) return { raw, key: null, value: null };
    return { raw, key: raw.slice(0, eq).trim(), value: raw.slice(eq + 1) };
  });
}

export const serializeIni = (lines: readonly IniLine[]): string => lines.map((l) => l.raw).join('\n');

const line = (key: string, value: string): IniLine => ({ raw: `${key}=${value}`, key, value });

/** Troca as chaves presentes no lugar; as ausentes entram no fim (antes da quebra de linha final). */
export function setIniKeys(text: string, patch: Readonly<Record<string, string>>): string {
  const lines = parseIni(text);
  const present = new Set(lines.map((l) => l.key).filter((k): k is string => k !== null));
  const replaced = lines.map((l) => (l.key !== null && l.key in patch ? line(l.key, patch[l.key]) : l));
  const added = Object.entries(patch).filter(([k]) => !present.has(k)).map(([k, v]) => line(k, v));
  if (added.length === 0) return serializeIni(replaced);
  const endsWithNewline = replaced.length > 0 && replaced[replaced.length - 1].raw === '';
  const body = endsWithNewline ? replaced.slice(0, -1) : replaced;
  const blank: IniLine = { raw: '', key: null, value: null };
  return serializeIni([...body, ...added, blank]);
}
