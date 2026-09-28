import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Nome do produto e o que sobrou do nome antigo (Enxame, até a 0.1.0). Quem instalou antes da troca tem a pasta de
 * dados, o banco, o AVD dourado, os snapshots e o `.env` com o nome antigo; o Electron migra a pasta na subida
 * (electron/legacy-migrate.ts), e até lá o daemon lê o que houver. Cópia de daemon/src/brand.ts: o main e o
 * daemon compilam separados, e os dois precisam concordar.
 */
export const BRAND = 'tapflock';
export const LEGACY_BRAND = 'enxame';

/** `TAPFLOCK_<nome>`; senão o `ENXAME_<nome>` de antes da troca. Vazio conta como ausente. */
export function brandEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  return env[`TAPFLOCK_${name}`] || env[`ENXAME_${name}`] || undefined;
}

/** Pasta de dados: a da env; senão a nova, a menos que só exista a antiga (ainda não migrada). */
export function dataDirFrom(
  env: NodeJS.ProcessEnv, home: string = os.homedir(), exists: (p: string) => boolean = existsSync, p: typeof path.posix = path,
): string {
  const fromEnv = brandEnv(env, 'DATA_DIR');
  if (fromEnv) return fromEnv;
  const fresh = p.join(home, '.local', 'share', BRAND);
  const legacy = p.join(home, '.local', 'share', LEGACY_BRAND);
  return exists(fresh) || !exists(legacy) ? fresh : legacy;
}

/** Banco SQLite da pasta: `tapflock.sqlite`, a menos que só exista o `enxame.sqlite` de antes da troca. */
export function dbFileIn(dir: string, exists: (p: string) => boolean = existsSync): string {
  const fresh = path.join(dir, `${BRAND}.sqlite`);
  const legacy = path.join(dir, `${LEGACY_BRAND}.sqlite`);
  return exists(fresh) || !exists(legacy) ? fresh : legacy;
}

/** Nome de exibição (janela, pasta de perfil do Electron); o de antes da troca fica para a migração. */
export const PRODUCT_NAME = 'Tapflock';
export const LEGACY_PRODUCT_NAME = 'Enxame';
