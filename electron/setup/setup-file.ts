import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

/** Formato lido também pelo daemon (daemon/src/config.ts: readSetupPaths). */
export const SetupFileSchema = z.object({
  version: z.literal(1),
  completedAt: z.string().nullable(),
  paths: z.object({ sdkRoot: z.string().min(1), ollamaBin: z.string().min(1).nullable() }),
});
export type SetupFileT = z.infer<typeof SetupFileSchema>;

/** Ausente (ENOENT) é normal na primeira execução; existente mas ilegível ou fora do formato merece um aviso. */
function parseOrWarn(file: string, read: () => string): SetupFileT | null {
  let text: string;
  try { text = read(); } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`[enxame] setup.json ilegível (${file}):`, (e as Error).message);
    return null;
  }
  try {
    const parsed = SetupFileSchema.safeParse(JSON.parse(text));
    if (parsed.success) return parsed.data;
    console.warn(`[enxame] setup.json inválido (${file}), ignorado:`, parsed.error.issues.map((i) => i.message).join('; '));
  } catch (e) { console.warn(`[enxame] setup.json inválido (${file}), ignorado:`, (e as Error).message); }
  return null;
}

export async function readSetupFile(file: string): Promise<SetupFileT | null> {
  const text = await readFile(file, 'utf8').then((t) => ({ t }), (e: unknown) => ({ e }));
  return parseOrWarn(file, () => { if ('e' in text) throw text.e; return text.t; });
}

/** Versão síncrona para a subida do main: os canais IPC precisam existir antes de a janela chamar `setup.status()`. */
export function readSetupFileSync(file: string): SetupFileT | null {
  return parseOrWarn(file, () => readFileSync(file, 'utf8'));
}

/** Gravação atômica (tmp + rename): o daemon nunca lê um arquivo pela metade. */
export async function writeSetupFile(file: string, data: SetupFileT): Promise<void> {
  const valid = SetupFileSchema.parse(data);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(valid, null, 2));
  await rename(tmp, file);
}
