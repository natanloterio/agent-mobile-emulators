import { generateText, stepCountIs, type LanguageModel, type ToolSet } from 'ai';
import type { DatabaseSync } from 'node:sqlite';
import type { IdentityRow } from '../db/identities.js';
import { connectMcp } from '../device/mcp.js';
import { toolPrefix } from '../worker/tools.js';
import { ROLE_KEYS, type ProviderRow, type RoleKey } from './config.js';
import { ProviderError } from './errors.js';
import { buildModel as defaultBuildModel } from './factory.js';
import { createOllamaSupervisor, type OllamaSupervisor } from './ollama.js';
import { invalidCallIds } from './quality.js';

export interface ProviderTest {
  readonly role: RoleKey; readonly model: string; readonly latencyMs: number; readonly tokensPerSec: number | null;
  readonly argsValid: boolean; readonly warning: string | null; readonly error: string | null; readonly at: string;
}
export interface ProbeDeps {
  readonly connect?: (url: string, token: string) => Promise<{ tools(): Promise<ToolSet>; close(): Promise<void> }>;
  readonly generate?: typeof generateText; readonly model?: LanguageModel;
  readonly ollama?: OllamaSupervisor; readonly buildModel?: typeof defaultBuildModel;
}

const EXTERNAL_WARNING = 'contexto desconhecido (Ollama externo, não subido pelo daemon — garanta OLLAMA_CONTEXT_LENGTH ≥ 32768)';

function save(db: DatabaseSync, t: ProviderTest): ProviderTest {
  db.prepare('insert into provider_test (role, model, latency_ms, tokens_per_sec, args_valid, warning, error) values (?, ?, ?, ?, ?, ?, ?)')
    .run(t.role, t.model, t.latencyMs, t.tokensPerSec, t.argsValid ? 1 : 0, t.warning, t.error);
  return t;
}

/** Spec §6: o caminho do worker encolhido — uma leitura de tela forçada, sem gate, sem step, sempre gravado. */
export async function testProvider(db: DatabaseSync, row: ProviderRow, identity: IdentityRow, env: { anthropicApiKey?: string }, deps: ProbeDeps = {}): Promise<ProviderTest> {
  const connect = deps.connect ?? connectMcp; const generate = deps.generate ?? generateText;
  const ollama = deps.ollama ?? createOllamaSupervisor(); const build = deps.buildModel ?? defaultBuildModel;
  const base: ProviderTest = { role: row.role, model: row.model, latencyMs: 0, tokensPerSec: null, argsValid: false, warning: null, error: null, at: new Date().toISOString() };
  const t0 = Date.now();
  let client: Awaited<ReturnType<typeof connect>> | null = null;
  try {
    let warning: string | null = null;
    if (row.mode === 'local') { const st = await ollama.ensure(row.endpoint, row.model); if (!st.spawnedByUs) warning = EXTERNAL_WARNING; }
    const model = deps.model ?? build(row, env);
    client = await connect(`http://127.0.0.1:${identity.mcpHostPort}/mcp`, identity.mcpToken);
    const all = await client.tools();
    const name = `${toolPrefix(identity.deviceSlug || null)}get_screen_state`;
    const screen = all[name]; if (!screen) throw new ProviderError('infra-local', `tool ${name} ausente no servidor MCP`);
    let genMs = 0;
    const r = await generate({
      model, tools: { [name]: screen }, toolChoice: 'required', prompt: 'Leia a tela atual.', stopWhen: stepCountIs(1),
      onLanguageModelCallEnd: (e) => { genMs = (e as { performance?: { responseTimeMs?: number } }).performance?.responseTimeMs ?? 0; },
    });
    const step = r.steps[0];
    const invalid = step ? invalidCallIds(step as never).length > 0 : true;
    const executed = !!step && step.content.some((p) => p.type === 'tool-result');
    const out = r.usage.outputTokens ?? 0;
    return save(db, { ...base, latencyMs: Date.now() - t0, tokensPerSec: genMs > 0 ? Math.round((out / (genMs / 1000)) * 10) / 10 : null, argsValid: !invalid && executed, warning });
  } catch (e) {
    const msg = ProviderError.isInstance(e) ? `${e.kind}: ${e.message}` : String((e as Error).message ?? e);
    return save(db, { ...base, latencyMs: Date.now() - t0, error: msg.slice(0, 300) });
  } finally { await client?.close().catch(() => undefined); }
}

export function lastProviderTests(db: DatabaseSync): Readonly<Partial<Record<RoleKey, ProviderTest>>> {
  const out: Partial<Record<RoleKey, ProviderTest>> = {};
  for (const role of ROLE_KEYS) {
    const x = db.prepare('select role, model, at, latency_ms, tokens_per_sec, args_valid, warning, error from provider_test where role=? order by id desc limit 1').get(role) as Record<string, unknown> | undefined;
    if (x) out[role] = { role, model: String(x.model), at: String(x.at), latencyMs: Number(x.latency_ms ?? 0), tokensPerSec: x.tokens_per_sec === null ? null : Number(x.tokens_per_sec), argsValid: Number(x.args_valid) === 1, warning: (x.warning as string | null) ?? null, error: (x.error as string | null) ?? null };
  }
  return out;
}
