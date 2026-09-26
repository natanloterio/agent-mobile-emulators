import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

export type RoleKey = 'lider' | 'worker' | 'esc';
export type ProviderMode = 'nuvem' | 'local';
export interface ProviderRow { readonly role: RoleKey; readonly mode: ProviderMode; readonly model: string; readonly endpoint: string }
export type ProviderConfig = Readonly<Record<RoleKey, ProviderRow>>;

export const ROLE_KEYS: readonly RoleKey[] = ['lider', 'worker', 'esc'];
export const LOCAL_ENDPOINT_DEFAULT = 'http://127.0.0.1:11434/v1';
export const CLOUD_ENDPOINT = 'anthropic';

/** Modelos default por papel na nuvem e o local vencedor do bake-off (spec §8, 2026-09-26). */
export const CLOUD_MODEL: Readonly<Record<RoleKey, string>> = { lider: 'claude-sonnet-5', worker: 'claude-haiku-4-5', esc: 'claude-haiku-4-5' };
export const LOCAL_MODEL_DEFAULT = 'gpt-oss:20b';

/** Default de fábrica (spec §8, benchmark de 2026-09-26): gpt-oss:20b venceu o bake-off e completou a tarefa sem disparar o piso. */
export const PROVIDER_DEFAULTS: ProviderConfig = {
  lider: { role: 'lider', mode: 'nuvem', model: CLOUD_MODEL.lider, endpoint: CLOUD_ENDPOINT },
  worker: { role: 'worker', mode: 'local', model: LOCAL_MODEL_DEFAULT, endpoint: LOCAL_ENDPOINT_DEFAULT },
  esc: { role: 'esc', mode: 'nuvem', model: CLOUD_MODEL.esc, endpoint: CLOUD_ENDPOINT },
};

/** Modelos disponíveis na nuvem para escolha manual (spec §8, 2026-09-26). */
export const CLOUD_MODELS: readonly string[] = ['claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5'];

const HttpUrl = z.string().url().refine((u) => /^https?:\/\//i.test(u), { message: 'endpoint precisa ser http(s)' });
export const ProviderPatch = z.object({
  mode: z.enum(['nuvem', 'local']).optional(),
  model: z.string().min(1).max(120).optional(),
  endpoint: HttpUrl.optional(),
}).strict();
export type ProviderPatchT = z.infer<typeof ProviderPatch>;

const rowOf = (x: Record<string, unknown>): ProviderRow => ({ role: x.role as RoleKey, mode: x.mode as ProviderMode, model: String(x.model), endpoint: String(x.endpoint) });

/** Uma linha legível para a tela: primeira mensagem de cada issue, sem duplicatas. */
export function patchErrorMessage(err: z.ZodError): string {
  return [...new Set(err.issues.map((i) => i.message))].join('; ');
}

/** Semeia os papéis ausentes com os defaults de fábrica. Chamado uma vez por `openDb`; nunca pelo snapshot. */
export function seedProviderConfig(db: DatabaseSync): void {
  const ins = db.prepare('insert or ignore into provider_config (role, mode, model, endpoint) values (?, ?, ?, ?)');
  for (const k of ROLE_KEYS) { const d = PROVIDER_DEFAULTS[k]; ins.run(d.role, d.mode, d.model, d.endpoint); }
}

export function readProviderConfig(db: DatabaseSync): ProviderConfig {
  const rows = (db.prepare('select role, mode, model, endpoint from provider_config').all() as Record<string, unknown>[]).map(rowOf);
  const byRole = new Map(rows.map((r) => [r.role, r]));
  return Object.fromEntries(ROLE_KEYS.map((k) => [k, byRole.get(k) ?? { ...PROVIDER_DEFAULTS[k] }])) as Record<RoleKey, ProviderRow>;
}

export function updateProvider(db: DatabaseSync, role: RoleKey, patchIn: ProviderPatchT): ProviderRow {
  seedProviderConfig(db);
  const patch = ProviderPatch.parse(patchIn);
  const cur = readProviderConfig(db)[role];
  const mode = patch.mode ?? cur.mode;
  const modeChanged = patch.mode !== undefined && patch.mode !== cur.mode;
  // Trocar o modo sem dizer o modelo não pode deixar "nuvem/gpt-oss:20b" nem "local/claude-haiku-4-5" (revisão final, Important 4).
  const endpoint = patch.endpoint ?? (modeChanged ? (mode === 'local' ? LOCAL_ENDPOINT_DEFAULT : CLOUD_ENDPOINT) : cur.endpoint);
  const model = patch.model ?? (modeChanged ? (mode === 'local' ? LOCAL_MODEL_DEFAULT : CLOUD_MODEL[role]) : cur.model);
  const next: ProviderRow = { role, mode, model, endpoint };
  db.prepare("update provider_config set mode=?, model=?, endpoint=?, updated_at=datetime('now') where role=?").run(next.mode, next.model, next.endpoint, role);
  return next;
}

/** `http://host:porta/v1` → `http://host:porta` (a API nativa do Ollama fica fora do /v1). */
export function ollamaBase(endpoint: string): string {
  return endpoint.replace(/\/+$/, '').replace(/\/v1$/, '').replace(/\/+$/, '');
}

export const providerLabel = (r: ProviderRow): string => `${r.mode}:${r.model}`;
