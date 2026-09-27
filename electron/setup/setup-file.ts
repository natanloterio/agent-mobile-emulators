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

export async function readSetupFile(file: string): Promise<SetupFileT | null> {
  try {
    const parsed = SetupFileSchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Versão síncrona para a subida do main: os canais IPC precisam existir antes de a janela chamar `setup.status()`. */
export function readSetupFileSync(file: string): SetupFileT | null {
  try {
    const parsed = SetupFileSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Gravação atômica (tmp + rename): o daemon nunca lê um arquivo pela metade. */
export async function writeSetupFile(file: string, data: SetupFileT): Promise<void> {
  const valid = SetupFileSchema.parse(data);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(valid, null, 2));
  await rename(tmp, file);
}
