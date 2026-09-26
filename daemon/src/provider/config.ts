import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

export type RoleKey = 'lider' | 'worker' | 'esc';
export type ProviderMode = 'nuvem' | 'local';
export interface ProviderRow { readonly role: RoleKey; readonly mode: ProviderMode; readonly model: string; readonly endpoint: string }
export type ProviderConfig = Readonly<Record<RoleKey, ProviderRow>>;

export const ROLE_KEYS: readonly RoleKey[] = ['lider', 'worker', 'esc'];
export const LOCAL_ENDPOINT_DEFAULT = 'http://127.0.0.1:11434/v1';
export const CLOUD_ENDPOINT = 'anthropic';

/** Default de fábrica: worker na nuvem até o benchmark da Task 10 aprovar o local (spec §4.2). */
export const PROVIDER_DEFAULTS: ProviderConfig = {
  lider: { role: 'lider', mode: 'nuvem', model: 'claude-sonnet-5', endpoint: CLOUD_ENDPOINT },
  worker: { role: 'worker', mode: 'nuvem', model: 'claude-haiku-4-5', endpoint: CLOUD_ENDPOINT },
  esc: { role: 'esc', mode: 'nuvem', model: 'claude-haiku-4-5', endpoint: CLOUD_ENDPOINT },
};

export const ProviderPatch = z.object({
  mode: z.enum(['nuvem', 'local']).optional(),
  model: z.string().min(1).max(120).optional(),
  endpoint: z.string().url().optional(),
}).strict();
export type ProviderPatchT = z.infer<typeof ProviderPatch>;

const rowOf = (x: Record<string, unknown>): ProviderRow => ({ role: x.role as RoleKey, mode: x.mode as ProviderMode, model: String(x.model), endpoint: String(x.endpoint) });

export function readProviderConfig(db: DatabaseSync): ProviderConfig {
  const rows = (db.prepare('select role, mode, model, endpoint from provider_config').all() as Record<string, unknown>[]).map(rowOf);
  const byRole = new Map(rows.map((r) => [r.role, r]));
  const ins = db.prepare('insert into provider_config (role, mode, model, endpoint) values (?, ?, ?, ?)');
  const out = Object.fromEntries(ROLE_KEYS.map((k) => {
    const have = byRole.get(k);
    if (have) return [k, have];
    const d = PROVIDER_DEFAULTS[k]; ins.run(d.role, d.mode, d.model, d.endpoint);
    return [k, { ...d }];
  })) as Record<RoleKey, ProviderRow>;
  return out;
}

export function updateProvider(db: DatabaseSync, role: RoleKey, patchIn: ProviderPatchT): ProviderRow {
  const patch = ProviderPatch.parse(patchIn);
  const cur = readProviderConfig(db)[role];
  const mode = patch.mode ?? cur.mode;
  const endpoint = patch.endpoint ?? (patch.mode && patch.mode !== cur.mode ? (mode === 'local' ? LOCAL_ENDPOINT_DEFAULT : CLOUD_ENDPOINT) : cur.endpoint);
  const next: ProviderRow = { role, mode, model: patch.model ?? cur.model, endpoint };
  db.prepare("update provider_config set mode=?, model=?, endpoint=?, updated_at=datetime('now') where role=?").run(next.mode, next.model, next.endpoint, role);
  return next;
}

/** `http://host:porta/v1` → `http://host:porta` (a API nativa do Ollama fica fora do /v1). */
export function ollamaBase(endpoint: string): string {
  return endpoint.replace(/\/+$/, '').replace(/\/v1$/, '').replace(/\/+$/, '');
}

export const providerLabel = (r: ProviderRow): string => `${r.mode}:${r.model}`;
