# Incremento 2 — Provedor local (Ollama) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O worker roda em modelo local via Ollama, com registro de provedores por papel, tela Provedores operando o registro real, teste de conexão, piso de qualidade com escalonamento para a nuvem, e um benchmark reprodutível que compara o vencedor do bake-off com o Haiku 4.5.

**Architecture:** Um módulo `daemon/src/provider/` concentra tudo que é provedor: registro em SQLite (`config.ts`), fábrica de `LanguageModel` (`factory.ts`), supervisor do processo `ollama serve` (`ollama.ts`), piso de qualidade (`quality.ts`) e teste de conexão (`probe.ts`). `runTask` passa a pedir o modelo à fábrica e roda em até dois segmentos (worker → escalonamento) sobre a mesma conversa. O daemon expõe `/providers`; o renderer sobrepõe o snapshot vivo à tela que já existe.

**Tech Stack:** Node ≥ 24 (`node:sqlite`), TypeScript strict, `ai@7.0.116`, `@ai-sdk/anthropic@4`, **`@ai-sdk/openai-compatible@^3.0.57` (novo)**, zod 4, vitest, Electron 33 + React 18, Ollama 0.30.7.

**Spec:** `docs/superpowers/specs/2026-09-26-incremento-2-provedor-local-design.md` (estende `docs/superpowers/specs/2026-09-26-android-swarm-design.md` §4.4 / fase 5)

## Global Constraints

- Node `>=24`; daemon compila com `tsc -p tsconfig.daemon.json` (NodeNext, `dist-daemon/`); renderer com `tsc -b`.
- `ai@7.0.116` fixo; `@ai-sdk/openai-compatible@^3.0.57` (peer `zod ^3.25 || ^4.1`, ok com zod 4).
- Imutabilidade: funções devolvem cópias; nada muta objetos de entrada. Arquivos ≤ 800 linhas; funções pequenas.
- Todo commit é condicionado à suíte verde (`npx vitest run`) e `tsc` limpo (regra herdada do incremento 1).
- Nunca imprimir `ANTHROPIC_API_KEY` (só tamanho/prefixo). `.env` fica fora do git.
- Gate somente-leitura e política de não repetir após falha permanecem inalterados.
- Default de fábrica do `worker` **continua `nuvem`/`claude-haiku-4-5`** até a Task 10 decidir com o relatório.
- O daemon **nunca** faz `ollama pull`; **nunca** mata um Ollama que não subiu.
- Env do Ollama subido pelo daemon: `OLLAMA_CONTEXT_LENGTH=32768`, `OLLAMA_KEEP_ALIVE=30m`, `OLLAMA_NUM_PARALLEL=1`; timeout de subida 20 s.
- Piso de qualidade: `limit = 3`, acumulado por tarefa, conta só `tool-call{invalid:true}`.
- Emulador sob `ANDROID_ADB_SERVER_PORT=5038`, identidade `conta1`; tarefa de benchmark: `Levantar comentários recentes sem resposta e propor rascunhos (não enviar)`, `stepBudget = 30`.

## Review Focus

1. **Ollama já de pé, subido por outra pessoa com contexto pequeno** → passos longos truncados em silêncio. Esperado: o teste de conexão devolve `warning: 'contexto desconhecido (Ollama externo)'` e o benchmark recusa rodar. Teste em Task 6 (`probe`) e Task 9 (`bench` recusa quando `spawnedByUs=false`).
2. **Endpoint digitado com `/v1/`, sem `/v1` ou com barra final** → `ollamaBase()` tem de bater em `http://host:porta` sempre. Teste em Task 1.
3. **Kill switch durante o segmento 2** → outcome `killed`, `degraded=1` preservado, identidade `idle`. Teste em Task 5.
4. **`PUT /providers/worker` enquanto uma tarefa roda** → 409 (trocar modelo no meio de uma conversa muda o prefixo e o comportamento). Teste em Task 7.
5. **Modelo pedido sem sufixo (`qwen3.5:27b`) enquanto `/api/tags` lista `qwen3.5:27b` ou `nome:latest`** → aceito em ambos; `gemma4` sem tag casa `gemma4:latest`. Teste em Task 4.

---

### Task 1: Schema, migração idempotente e registro de provedores

**Files:**
- Modify: `daemon/src/db/schema.ts` (duas tabelas novas)
- Create: `daemon/src/db/migrate.ts`
- Modify: `daemon/src/db/open.ts` (chama `applyMigrations`)
- Create: `daemon/src/provider/config.ts`
- Test: `daemon/test/provider-config.test.ts`

**Interfaces:**
- Consumes: `openDb(path)` de `db/open.ts`.
- Produces:
  - `applyMigrations(db: DatabaseSync): void` — adiciona colunas ausentes (`step.provider text`, `step.gen_ms integer`, `step.invalid_call integer not null default 0`, `task.degraded integer not null default 0`, `task.escalated_at_step integer`).
  - `type RoleKey = 'lider' | 'worker' | 'esc'`; `type ProviderMode = 'nuvem' | 'local'`.
  - `interface ProviderRow { readonly role: RoleKey; readonly mode: ProviderMode; readonly model: string; readonly endpoint: string }`.
  - `type ProviderConfig = Readonly<Record<RoleKey, ProviderRow>>`.
  - `PROVIDER_DEFAULTS: ProviderConfig` (worker `nuvem`/`claude-haiku-4-5`/`anthropic`; esc `nuvem`/`claude-haiku-4-5`/`anthropic`; lider `nuvem`/`claude-sonnet-5`/`anthropic`).
  - `LOCAL_ENDPOINT_DEFAULT = 'http://127.0.0.1:11434/v1'`.
  - `ProviderPatch` (zod): `{ mode?, model? (1..120 chars), endpoint? (url) }`, `.strict()`.
  - `readProviderConfig(db): ProviderConfig` — semeia defaults na primeira leitura.
  - `updateProvider(db, role: RoleKey, patch: z.infer<typeof ProviderPatch>): ProviderRow` — ao mudar `mode` para `local` sem `endpoint`, aplica `LOCAL_ENDPOINT_DEFAULT`; para `nuvem`, `endpoint = 'anthropic'`.
  - `ollamaBase(endpoint: string): string` — remove `/v1`, `/v1/` e barra final.
  - `providerLabel(r: ProviderRow): string` → `` `${r.mode}:${r.model}` ``.

- [ ] **Step 1: Teste (falha)**

`daemon/test/provider-config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { LOCAL_ENDPOINT_DEFAULT, ollamaBase, PROVIDER_DEFAULTS, providerLabel, readProviderConfig, updateProvider } from '../src/provider/config.js';

describe('provider_config', () => {
  it('semeia defaults na primeira leitura e devolve cópia', () => {
    const db = openDb(':memory:');
    const a = readProviderConfig(db);
    expect(a).toEqual(PROVIDER_DEFAULTS);
    expect(a.worker).toMatchObject({ mode: 'nuvem', model: 'claude-haiku-4-5' });
    expect(a).not.toBe(PROVIDER_DEFAULTS);
    expect((db.prepare('select count(*) as n from provider_config').get() as { n: number }).n).toBe(3);
  });
  it('updateProvider aplica patch, endpoint default do local, e valida', () => {
    const db = openDb(':memory:');
    const w = updateProvider(db, 'worker', { mode: 'local', model: 'qwen3.5:27b' });
    expect(w).toEqual({ role: 'worker', mode: 'local', model: 'qwen3.5:27b', endpoint: LOCAL_ENDPOINT_DEFAULT });
    expect(readProviderConfig(db).worker.model).toBe('qwen3.5:27b');
    expect(updateProvider(db, 'worker', { mode: 'nuvem' }).endpoint).toBe('anthropic');
    expect(() => updateProvider(db, 'worker', { mode: 'x' } as never)).toThrow();
    expect(() => updateProvider(db, 'worker', { endpoint: 'não é url' })).toThrow();
    expect(() => updateProvider(db, 'worker', { foo: 1 } as never)).toThrow();
  });
  it('ollamaBase normaliza /v1, /v1/ e barra final (Review Focus 2)', () => {
    for (const e of ['http://127.0.0.1:11434/v1', 'http://127.0.0.1:11434/v1/', 'http://127.0.0.1:11434/', 'http://127.0.0.1:11434'])
      expect(ollamaBase(e)).toBe('http://127.0.0.1:11434');
  });
  it('providerLabel e migração idempotente (colunas novas existem; abrir duas vezes não quebra)', () => {
    const db = openDb(':memory:');
    expect(providerLabel({ role: 'worker', mode: 'local', model: 'm', endpoint: 'e' })).toBe('local:m');
    const cols = (t: string) => (db.prepare(`pragma table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    expect(cols('step')).toEqual(expect.arrayContaining(['provider', 'gen_ms', 'invalid_call']));
    expect(cols('task')).toEqual(expect.arrayContaining(['degraded', 'escalated_at_step']));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --project daemon daemon/test/provider-config.test.ts`
Expected: FAIL — `Cannot find module '../src/provider/config.js'`

- [ ] **Step 3: Implementar**

Acrescentar ao final de `SCHEMA` em `daemon/src/db/schema.ts` (antes do fechamento da template string):

```sql
create table if not exists provider_config (
  role text primary key check (role in ('lider','worker','esc')),
  mode text not null check (mode in ('nuvem','local')),
  model text not null, endpoint text not null,
  updated_at text not null default (datetime('now'))
);
create table if not exists provider_test (
  id integer primary key autoincrement, role text not null, model text not null,
  at text not null default (datetime('now')), latency_ms integer, tokens_per_sec real,
  args_valid integer not null, warning text, error text
);
```

`daemon/src/db/migrate.ts`:

```ts
import type { DatabaseSync } from 'node:sqlite';

/** Colunas adicionadas depois do incremento 1. `alter table add column` não é idempotente no SQLite; checamos antes. */
const COLUMNS: readonly { table: string; column: string; ddl: string }[] = [
  { table: 'step', column: 'provider', ddl: 'text' },
  { table: 'step', column: 'gen_ms', ddl: 'integer' },
  { table: 'step', column: 'invalid_call', ddl: 'integer not null default 0' },
  { table: 'task', column: 'degraded', ddl: 'integer not null default 0' },
  { table: 'task', column: 'escalated_at_step', ddl: 'integer' },
];

export function applyMigrations(db: DatabaseSync): void {
  for (const m of COLUMNS) {
    const have = (db.prepare(`pragma table_info(${m.table})`).all() as { name: string }[]).some((c) => c.name === m.column);
    if (!have) db.exec(`alter table ${m.table} add column ${m.column} ${m.ddl}`);
  }
}
```

`daemon/src/db/open.ts`:

```ts
import { DatabaseSync } from 'node:sqlite';
import { applyMigrations } from './migrate.js';
import { SCHEMA } from './schema.js';

export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('pragma journal_mode = wal; pragma foreign_keys = on;');
  db.exec(SCHEMA);
  applyMigrations(db);
  return db;
}
```

`daemon/src/provider/config.ts`:

```ts
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
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run --project daemon daemon/test/provider-config.test.ts && npx vitest run`
Expected: PASS (4 novos; suíte inteira verde — `db.test.ts` continua passando com o schema novo)

- [ ] **Step 5: Commit**

```bash
git add daemon/src/db/schema.ts daemon/src/db/migrate.ts daemon/src/db/open.ts daemon/src/provider/config.ts daemon/test/provider-config.test.ts
git commit -m "feat(provider): registro de provedores por papel, migração idempotente e colunas de proveniência"
```

---

### Task 2: Piso de qualidade

**Files:**
- Create: `daemon/src/provider/quality.ts`
- Test: `daemon/test/quality.test.ts`

**Interfaces:**
- Consumes: `StepLike`, `StepPart` de `worker/record.ts`.
- Produces:
  - `invalidCallIds(step: StepLike): readonly string[]` — `toolCallId` de cada parte `tool-call` com `invalid === true`.
  - `interface QualityFloor { observe(step: StepLike): number; tripped(): boolean; count(): number; readonly limit: number }`.
  - `createQualityFloor(limit = 3): QualityFloor` — `observe` devolve o total acumulado.

Fato medido (`ai@7.0.116`, `.verify/invalid-probe.mjs`): argumento fora do schema, tool inexistente e JSON quebrado chegam **todos** como `tool-call{invalid:true}` + `tool-error` (erro é string). Contar a parte `tool-call` inválida cobre os três sem olhar o erro.

- [ ] **Step 1: Teste (falha)**

`daemon/test/quality.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createQualityFloor, invalidCallIds } from '../src/provider/quality.js';
import type { StepLike } from '../src/worker/record.js';

const usage = { inputTokens: 1, outputTokens: 1 };
const step = (content: StepLike['content'], n = 1): StepLike => ({ stepNumber: n, text: '', content, usage });
const ok = { type: 'tool-call', toolCallId: 'a', toolName: 'android_conta1_tap_node', input: { node_id: 'x' } };
const bad = (id: string) => ({ type: 'tool-call', toolCallId: id, toolName: 'android_conta1_tap_node', input: {}, invalid: true });
const gateDenied = { type: 'tool-approval-response', approvalId: 'p', approved: false, toolCall: { toolCallId: 'g', toolName: 'android_conta1_tap_node' } };
const infraErr = { type: 'tool-error', toolCallId: 'a', toolName: 'android_conta1_tap_node', error: new Error("device 'emulator-5554' not found") };

describe('QualityFloor', () => {
  it('invalidCallIds devolve só as tool calls marcadas invalid', () => {
    expect(invalidCallIds(step([ok, bad('b1'), gateDenied, infraErr]))).toEqual(['b1']);
    expect(invalidCallIds(step([{ type: 'text' }]))).toEqual([]);
  });
  it('acumula por tarefa (não consecutivo) e dispara em limit', () => {
    const f = createQualityFloor(3);
    expect(f.observe(step([bad('1')]))).toBe(1);
    expect(f.observe(step([ok, gateDenied, infraErr]))).toBe(1);
    expect(f.tripped()).toBe(false);
    f.observe(step([bad('2')]));
    expect(f.tripped()).toBe(false);
    f.observe(step([bad('3')]));
    expect(f.tripped()).toBe(true); expect(f.count()).toBe(3); expect(f.limit).toBe(3);
  });
  it('não conta negação do gate, erro de infra nem passo só de texto', () => {
    const f = createQualityFloor(1);
    f.observe(step([gateDenied])); f.observe(step([infraErr])); f.observe(step([{ type: 'text' }]));
    expect(f.tripped()).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --project daemon daemon/test/quality.test.ts`
Expected: FAIL — `Cannot find module '../src/provider/quality.js'`

- [ ] **Step 3: Implementar**

`daemon/src/provider/quality.ts`:

```ts
import type { StepLike } from '../worker/record.js';

/** Parte `tool-call` do ai@7 com a flag que o SDK põe quando input/nome não validam. */
interface MaybeInvalidCall { readonly type: string; readonly toolCallId?: string; readonly invalid?: boolean }

export function invalidCallIds(step: StepLike): readonly string[] {
  return step.content
    .filter((p): p is MaybeInvalidCall & { toolCallId: string } => p.type === 'tool-call' && (p as MaybeInvalidCall).invalid === true && typeof (p as MaybeInvalidCall).toolCallId === 'string')
    .map((p) => p.toolCallId);
}

export interface QualityFloor {
  readonly limit: number;
  observe(step: StepLike): number;
  tripped(): boolean;
  count(): number;
}

/** Spec §4.5: acumulado por tarefa; só tool calls inválidas contam. Negação do gate e erros de infra não são culpa do modelo. */
export function createQualityFloor(limit = 3): QualityFloor {
  let n = 0;
  return {
    limit,
    observe: (step) => { n += invalidCallIds(step).length; return n; },
    tripped: () => n >= limit,
    count: () => n,
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run --project daemon daemon/test/quality.test.ts`
Expected: PASS (3)

- [ ] **Step 5: Commit**

```bash
git add daemon/src/provider/quality.ts daemon/test/quality.test.ts
git commit -m "feat(provider): piso de qualidade — conta tool calls inválidas por tarefa"
```

---

### Task 3: Fábrica de modelos (Anthropic | OpenAI-compatible)

**Files:**
- Modify: `package.json` (dependência nova)
- Create: `daemon/src/provider/errors.ts`
- Create: `daemon/src/provider/factory.ts`
- Test: `daemon/test/factory.test.ts`

**Interfaces:**
- Consumes: `ProviderRow` (Task 1).
- Produces:
  - `class ProviderError extends Error { readonly kind: 'auth' | 'infra-local'; constructor(kind, message) }` em `errors.ts`.
  - `interface FactoryDeps { readonly fetch?: typeof fetch }`.
  - `buildModel(row: ProviderRow, env: { anthropicApiKey?: string }, deps?: FactoryDeps): LanguageModel` — `nuvem` sem chave → `ProviderError('auth')`.
  - `providerOptionsFor(row: ProviderRow): Record<string, Record<string, unknown>>` — `nuvem` → `{ anthropic: { disableParallelToolUse: true, cacheControl: { type: 'ephemeral', ttl: '1h' } } }`; `local` → `{}`.
  - `pricingFor(row: ProviderRow): Pricing` — `nuvem` → `HAIKU_PRICING`; `local` → `LOCAL_PRICING = { inputPerM: 0, outputPerM: 0, cacheReadPerM: 0 }` (exportado de `factory.ts`).

- [ ] **Step 1: Instalar a dependência**

Run: `npm i @ai-sdk/openai-compatible@^3.0.57`
Expected: `package.json` ganha `"@ai-sdk/openai-compatible": "^3.0.57"`; sem erro de peer.

- [ ] **Step 2: Teste (falha)**

`daemon/test/factory.test.ts`:

```ts
import { generateText } from 'ai';
import { describe, expect, it } from 'vitest';
import { ProviderError } from '../src/provider/errors.js';
import { buildModel, LOCAL_PRICING, pricingFor, providerOptionsFor } from '../src/provider/factory.js';
import { HAIKU_PRICING } from '../src/worker/record.js';

const local = { role: 'worker' as const, mode: 'local' as const, model: 'qwen3.5:27b', endpoint: 'http://127.0.0.1:11434/v1' };
const cloud = { role: 'esc' as const, mode: 'nuvem' as const, model: 'claude-haiku-4-5', endpoint: 'anthropic' };

/** fetch falso que responde uma chat completion mínima e grava a URL/corpo chamados. */
function fakeOpenAI() {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetchFn = (async (input: unknown, init?: { body?: string }) => {
    calls.push({ url: String(input), body: JSON.parse(init?.body ?? '{}') });
    const body = { id: 'x', object: 'chat.completion', created: 0, model: 'qwen3.5:27b',
      choices: [{ index: 0, message: { role: 'assistant', content: 'oi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 } };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

describe('buildModel', () => {
  it('local → openai-compatible batendo em {endpoint}/chat/completions com o modelo do registro', async () => {
    const { fetchFn, calls } = fakeOpenAI();
    const model = buildModel(local, {}, { fetch: fetchFn });
    const r = await generateText({ model, prompt: 'x' });
    expect(r.text).toBe('oi');
    expect(calls[0].url).toBe('http://127.0.0.1:11434/v1/chat/completions');
    expect(calls[0].body.model).toBe('qwen3.5:27b');
    expect(r.usage.inputTokens).toBe(5);
  });
  it('nuvem → anthropic com a chave; sem chave lança ProviderError auth antes de chamar', () => {
    const m = buildModel(cloud, { anthropicApiKey: 'sk-ant-test-0000000000000000' });
    expect(m.provider).toMatch(/anthropic/); expect(m.modelId).toBe('claude-haiku-4-5');
    expect(() => buildModel(cloud, {})).toThrow(ProviderError);
    try { buildModel(cloud, {}); } catch (e) { expect((e as ProviderError).kind).toBe('auth'); }
  });
  it('providerOptions e pricing dependem do modo', () => {
    expect(providerOptionsFor(cloud)).toEqual({ anthropic: { disableParallelToolUse: true, cacheControl: { type: 'ephemeral', ttl: '1h' } } });
    expect(providerOptionsFor(local)).toEqual({});
    expect(pricingFor(cloud)).toBe(HAIKU_PRICING); expect(pricingFor(local)).toBe(LOCAL_PRICING);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run --project daemon daemon/test/factory.test.ts`
Expected: FAIL — `Cannot find module '../src/provider/errors.js'`

- [ ] **Step 4: Implementar**

`daemon/src/provider/errors.ts`:

```ts
/** Classes novas do spec §7. `auth` já existia como Halt no worker; aqui é lançada antes de qualquer chamada. */
export class ProviderError extends Error {
  constructor(public readonly kind: 'auth' | 'infra-local', message: string) { super(message); this.name = 'ProviderError'; }
  static isInstance(e: unknown): e is ProviderError { return e instanceof ProviderError; }
}
```

`daemon/src/provider/factory.ts`:

```ts
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import { HAIKU_PRICING, type Pricing } from '../worker/record.js';
import type { ProviderRow } from './config.js';
import { ProviderError } from './errors.js';

export interface FactoryDeps { readonly fetch?: typeof fetch }

/** Local custa segundos de GPU, não dólares (spec §5); o custo em s vem de gen_ms. */
export const LOCAL_PRICING: Pricing = { inputPerM: 0, outputPerM: 0, cacheReadPerM: 0 };

export function buildModel(row: ProviderRow, env: { anthropicApiKey?: string }, deps: FactoryDeps = {}): LanguageModel {
  if (row.mode === 'local') {
    return createOpenAICompatible({ name: 'ollama', baseURL: row.endpoint, includeUsage: true, fetch: deps.fetch })(row.model);
  }
  if (!env.anthropicApiKey) throw new ProviderError('auth', `papel ${row.role} está na nuvem e ANTHROPIC_API_KEY está ausente`);
  return createAnthropic({ apiKey: env.anthropicApiKey, fetch: deps.fetch })(row.model);
}

/** Opções que só fazem sentido no provider Anthropic; o openai-compatible as ignoraria, mas melhor não enviar. */
export function providerOptionsFor(row: ProviderRow): Record<string, Record<string, unknown>> {
  return row.mode === 'nuvem' ? { anthropic: { disableParallelToolUse: true, cacheControl: { type: 'ephemeral', ttl: '1h' } } } : {};
}

export function pricingFor(row: ProviderRow): Pricing { return row.mode === 'nuvem' ? HAIKU_PRICING : LOCAL_PRICING; }
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run --project daemon daemon/test/factory.test.ts && npx tsc -p tsconfig.daemon.json --noEmit`
Expected: PASS (3); tsc limpo. Se `createOpenAICompatible` reclamar do tipo de `fetch`, tipar `deps.fetch as never` — registrar no ledger.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json daemon/src/provider/errors.ts daemon/src/provider/factory.ts daemon/test/factory.test.ts
git commit -m "feat(provider): fábrica de modelos anthropic | openai-compatible (Ollama) com opções e preço por modo"
```

---

### Task 4: Supervisor do Ollama

**Files:**
- Create: `daemon/src/provider/ollama.ts`
- Test: `daemon/test/ollama.test.ts`

**Interfaces:**
- Consumes: `ollamaBase` (Task 1), `ProviderError` (Task 3).
- Produces:
  - `OLLAMA_ENV = { OLLAMA_CONTEXT_LENGTH: '32768', OLLAMA_KEEP_ALIVE: '30m', OLLAMA_NUM_PARALLEL: '1' } as const`.
  - `interface ChildLike { readonly pid?: number; kill(signal?: NodeJS.Signals): boolean; on(ev: 'exit', cb: () => void): unknown }`.
  - `interface OllamaDeps { fetch?: typeof fetch; spawn?: (cmd: string, args: readonly string[], opts: { env: NodeJS.ProcessEnv; stdio: unknown }) => ChildLike; sleep?: (ms: number) => Promise<void>; timeoutMs?: number; logPath?: string; openLog?: (path: string) => unknown }`.
  - `interface OllamaStatus { readonly running: boolean; readonly spawnedByUs: boolean; readonly pid: number | null; readonly models: readonly string[] }`.
  - `modelListed(models: readonly string[], wanted: string): boolean` — casa exato, `wanted:latest` quando `wanted` não tem tag, e `wanted` sem tag quando a lista tem `nome:latest`.
  - `createOllamaSupervisor(deps?: OllamaDeps): OllamaSupervisor` com `ensure(endpoint: string, model: string): Promise<OllamaStatus>`, `unload(endpoint: string, model: string): Promise<void>` (POST `/api/generate` `{ model, keep_alive: 0 }`), `stop(): void` (SIGTERM só no filho próprio), `status(): OllamaStatus | null`.

- [ ] **Step 1: Teste (falha)**

`daemon/test/ollama.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ProviderError } from '../src/provider/errors.js';
import { createOllamaSupervisor, modelListed, OLLAMA_ENV } from '../src/provider/ollama.js';

const tags = (...names: string[]) => new Response(JSON.stringify({ models: names.map((name) => ({ name })) }), { status: 200 });
const refused = () => { throw new Error('fetch failed: ECONNREFUSED'); };

function harness(script: (() => Response)[]) {
  const spawned: { cmd: string; args: readonly string[]; env: NodeJS.ProcessEnv }[] = [];
  const killed: string[] = [];
  const posts: { url: string; body: unknown }[] = [];
  let i = 0;
  const fetchFn = (async (url: unknown, init?: { method?: string; body?: string }) => {
    if (init?.method === 'POST') { posts.push({ url: String(url), body: JSON.parse(init.body ?? '{}') }); return new Response('{}', { status: 200 }); }
    const step = script[Math.min(i, script.length - 1)]; i++; return step();
  }) as unknown as typeof fetch;
  const child = { pid: 4242, kill: (s?: string) => { killed.push(String(s)); return true; }, on: () => undefined };
  const sup = createOllamaSupervisor({
    fetch: fetchFn, sleep: async () => {}, timeoutMs: 20_000, logPath: '/dev/null', openLog: () => 'ignore',
    spawn: (cmd, args, opts) => { spawned.push({ cmd, args, env: opts.env }); return child; },
  });
  return { sup, spawned, killed, posts };
}

describe('supervisor do Ollama', () => {
  it('endpoint vivo → não spawna, lista modelos, spawnedByUs=false e stop() não mata', async () => {
    const h = harness([() => tags('qwen3.5:27b')]);
    const st = await h.sup.ensure('http://127.0.0.1:11434/v1', 'qwen3.5:27b');
    expect(st).toEqual({ running: true, spawnedByUs: false, pid: null, models: ['qwen3.5:27b'] });
    expect(h.spawned).toHaveLength(0); h.sup.stop(); expect(h.killed).toEqual([]);
  });
  it('endpoint morto → spawna `ollama serve` com o env exato e espera /api/tags', async () => {
    const h = harness([refused, refused, () => tags('qwen3.5:27b')]);
    const st = await h.sup.ensure('http://127.0.0.1:11434/v1', 'qwen3.5:27b');
    expect(st.spawnedByUs).toBe(true); expect(st.pid).toBe(4242);
    expect(h.spawned[0]).toMatchObject({ cmd: 'ollama', args: ['serve'] });
    expect(h.spawned[0].env).toMatchObject({ ...OLLAMA_ENV, OLLAMA_HOST: '127.0.0.1:11434' });
    h.sup.stop(); expect(h.killed).toEqual(['SIGTERM']);
  });
  it('não sobe dentro do timeout → mata o filho e lança infra-local', async () => {
    const h = harness([refused]);
    const sup = createOllamaSupervisor({ fetch: (async () => refused()) as never, sleep: async () => {}, timeoutMs: 1, logPath: '/dev/null', openLog: () => 'x', spawn: () => ({ pid: 1, kill: (s?: string) => { h.killed.push(String(s)); return true; }, on: () => undefined }) });
    await expect(sup.ensure('http://127.0.0.1:11434/v1', 'm')).rejects.toSatisfy((e: unknown) => ProviderError.isInstance(e) && e.kind === 'infra-local' && /20 s|timeout|não subiu/i.test(e.message));
    expect(h.killed).toContain('SIGTERM');
  });
  it('modelo ausente em /api/tags → infra-local com instrução de pull; nunca faz pull', async () => {
    const h = harness([() => tags('gemma4:12b')]);
    await expect(h.sup.ensure('http://127.0.0.1:11434/v1', 'qwen3.5:27b')).rejects.toSatisfy((e: unknown) => ProviderError.isInstance(e) && e.kind === 'infra-local' && /ollama pull qwen3\.5:27b/.test(e.message));
    expect(h.posts).toEqual([]);
  });
  it('modelListed casa tag :latest nos dois sentidos (Review Focus 5)', () => {
    expect(modelListed(['gemma4:latest'], 'gemma4')).toBe(true);
    expect(modelListed(['gemma4:12b'], 'gemma4')).toBe(false);
    expect(modelListed(['qwen3.5:27b'], 'qwen3.5:27b')).toBe(true);
    expect(modelListed(['llama3.2:latest'], 'llama3.2:latest')).toBe(true);
  });
  it('unload envia keep_alive 0 na API nativa', async () => {
    const h = harness([() => tags('a')]);
    await h.sup.unload('http://127.0.0.1:11434/v1', 'a');
    expect(h.posts[0]).toEqual({ url: 'http://127.0.0.1:11434/api/generate', body: { model: 'a', keep_alive: 0 } });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --project daemon daemon/test/ollama.test.ts`
Expected: FAIL — `Cannot find module '../src/provider/ollama.js'`

- [ ] **Step 3: Implementar**

`daemon/src/provider/ollama.ts`:

```ts
import { spawn as nodeSpawn } from 'node:child_process';
import { openSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ollamaBase } from './config.js';
import { ProviderError } from './errors.js';

/** Spec §4.3: contexto ≥ 32k (passos chegam a ~19k), modelo fica quente entre passos, um worker por vez neste incremento. */
export const OLLAMA_ENV = { OLLAMA_CONTEXT_LENGTH: '32768', OLLAMA_KEEP_ALIVE: '30m', OLLAMA_NUM_PARALLEL: '1' } as const;
const DEFAULT_TIMEOUT_MS = 20_000;
const POLL_MS = 250;

export interface ChildLike { readonly pid?: number; kill(signal?: NodeJS.Signals): boolean; on(ev: 'exit', cb: () => void): unknown }
export interface OllamaDeps {
  readonly fetch?: typeof fetch;
  readonly spawn?: (cmd: string, args: readonly string[], opts: { env: NodeJS.ProcessEnv; stdio: unknown }) => ChildLike;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly timeoutMs?: number;
  readonly logPath?: string;
  readonly openLog?: (p: string) => unknown;
}
export interface OllamaStatus { readonly running: boolean; readonly spawnedByUs: boolean; readonly pid: number | null; readonly models: readonly string[] }
export interface OllamaSupervisor {
  ensure(endpoint: string, model: string): Promise<OllamaStatus>;
  unload(endpoint: string, model: string): Promise<void>;
  stop(): void;
  status(): OllamaStatus | null;
}

export function modelListed(models: readonly string[], wanted: string): boolean {
  const hasTag = wanted.includes(':');
  return models.some((m) => m === wanted || (!hasTag && m === `${wanted}:latest`) || (wanted.endsWith(':latest') && m === wanted.slice(0, -7)));
}

async function listModels(fetchFn: typeof fetch, base: string): Promise<readonly string[] | null> {
  try {
    const r = await fetchFn(`${base}/api/tags`);
    if (!r.ok) return null;
    const j = await r.json() as { models?: { name: string }[] };
    return (j.models ?? []).map((m) => m.name);
  } catch { return null; }
}

export function createOllamaSupervisor(deps: OllamaDeps = {}): OllamaSupervisor {
  const fetchFn = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const logPath = deps.logPath ?? path.join(os.homedir(), '.local', 'share', 'enxame', 'ollama.log');
  const openLog = deps.openLog ?? ((p: string) => openSync(p, 'a'));
  const spawnFn = deps.spawn ?? ((cmd, args, opts) => nodeSpawn(cmd, args, { env: opts.env, stdio: opts.stdio as never, detached: false }) as unknown as ChildLike);
  let child: ChildLike | null = null;
  let last: OllamaStatus | null = null;

  const checkModel = (models: readonly string[], model: string) => {
    if (!modelListed(models, model)) throw new ProviderError('infra-local', `modelo ${model} não está no disco do Ollama; rode: ollama pull ${model}`);
  };

  return {
    status: () => last,
    stop: () => { if (child) { child.kill('SIGTERM'); child = null; } },
    unload: async (endpoint, model) => {
      await fetchFn(`${ollamaBase(endpoint)}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, keep_alive: 0 }) }).catch(() => undefined);
    },
    ensure: async (endpoint, model) => {
      const base = ollamaBase(endpoint);
      const alive = await listModels(fetchFn, base);
      if (alive) { checkModel(alive, model); last = { running: true, spawnedByUs: child !== null, pid: child?.pid ?? null, models: alive }; return last; }
      const host = base.replace(/^https?:\/\//, '');
      const log = openLog(logPath);
      child = spawnFn('ollama', ['serve'], { env: { ...process.env, ...OLLAMA_ENV, OLLAMA_HOST: host }, stdio: ['ignore', log, log] });
      child.on('exit', () => { child = null; });
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        await sleep(POLL_MS);
        const models = await listModels(fetchFn, base);
        if (models) { checkModel(models, model); last = { running: true, spawnedByUs: true, pid: child?.pid ?? null, models }; return last; }
      }
      child?.kill('SIGTERM'); child = null;
      throw new ProviderError('infra-local', `Ollama não subiu em ${Math.round(timeoutMs / 1000)} s; veja ${logPath}`);
    },
  };
}
```

Atenção ao teste de timeout: com `sleep` instantâneo e `timeoutMs: 1`, o laço pode nem entrar — o `Date.now()` avança pouco; garanta que o `while` tenta ao menos uma vez ou aceite zero tentativas (o teste só exige `infra-local` + SIGTERM). Se o `rejects.toSatisfy` não existir na versão do vitest, trocar por `await expect(...).rejects.toMatchObject({ kind: 'infra-local' })`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run --project daemon daemon/test/ollama.test.ts && npx tsc -p tsconfig.daemon.json --noEmit`
Expected: PASS (6); tsc limpo

- [ ] **Step 5: Commit**

```bash
git add daemon/src/provider/ollama.ts daemon/test/ollama.test.ts
git commit -m "feat(provider): supervisor do Ollama — sobe sob demanda com contexto 32k, nunca mata processo externo"
```

---

### Task 5: Worker em dois segmentos (fábrica, piso, escalonamento, proveniência)

**Files:**
- Modify: `daemon/src/db/tasks.ts` (`finishStep` ganha `provider`, `genMs`, `invalidCall`; nova `markDegraded`)
- Modify: `daemon/src/worker/record.ts` (`recordStep` ganha `extra`)
- Modify: `daemon/src/worker/run.ts`
- Modify: `daemon/src/worker/prompt.ts` (nota de escalada)
- Test: `daemon/test/real-sdk.test.ts` (novo `describe`), `daemon/test/record.test.ts` (1 teste)

**Interfaces:**
- Consumes: `readProviderConfig`, `providerLabel` (T1); `createQualityFloor`, `invalidCallIds` (T2); `buildModel`, `providerOptionsFor`, `pricingFor`, `ProviderError` (T3); `OllamaSupervisor` (T4).
- Produces:
  - `finishStep(db, stepId, p & { provider?: string; genMs?: number; invalidCall?: boolean })`.
  - `markDegraded(db, taskId, atStep: number): void`.
  - `recordStep(db, taskId, step, pricing, pending, extra?: { provider?: string; genMs?: number | null })` — marca `invalid_call=1` nas linhas cujos `toolCallId` estão em `invalidCallIds(step)`.
  - `RunTaskOpts` ganha `providers?: ProviderConfig` (default `readProviderConfig(db)`).
  - `RunTaskDeps` ganha `ollama?: OllamaSupervisor`, `buildModel?: typeof buildModel`, `escModel?: LanguageModel` (mock do segmento 2 nos testes).
  - `RunTaskResult.outcome` ganha `'quality-floor'`; `RunTaskResult` ganha `degraded: boolean; escalatedAtStep: number | null; provider: string; genMs: number; invalidCalls: number`.
  - `ESCALATION_NOTE(n: number, model: string): string` em `prompt.ts`.

- [ ] **Step 1: Testes (falham)**

Acrescentar em `daemon/test/record.test.ts`:

```ts
describe('recordStep — proveniência (incremento 2)', () => {
  it('grava provider, gen_ms e invalid_call nas linhas certas', () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const { taskId } = createGoalAndTask(db, 'conta1', 'objetivo');
    recordStep(db, taskId, { stepNumber: 1, text: '', usage: { inputTokens: 10, outputTokens: 2 }, content: [
      { type: 'tool-call', toolCallId: 'c1', toolName: 'android_conta1_tap_node', input: {}, invalid: true },
      { type: 'tool-error', toolCallId: 'c1', toolName: 'android_conta1_tap_node', error: 'Invalid input' },
    ] } as never, PRICING, new Map(), { provider: 'local:qwen3.5:27b', genMs: 812 });
    const s = db.prepare('select provider, gen_ms, invalid_call, result_excerpt from step where task_id=?').get(taskId) as { provider: string; gen_ms: number; invalid_call: number; result_excerpt: string };
    expect(s).toMatchObject({ provider: 'local:qwen3.5:27b', gen_ms: 812, invalid_call: 1 });
    expect(s.result_excerpt).toMatch(/^ERRO/);
  });
});
```

Acrescentar ao final de `daemon/test/real-sdk.test.ts`:

```ts
import { createOllamaSupervisor } from '../src/provider/ollama.js';
import { ProviderError } from '../src/provider/errors.js';

const invalid = (id: string) => calls({ id, name: 'android_conta1_tap_node', input: { wrong: true } });
const LOCAL = { role: 'worker' as const, mode: 'local' as const, model: 'qwen3.5:27b', endpoint: 'http://127.0.0.1:11434/v1' };
const ESC = { role: 'esc' as const, mode: 'nuvem' as const, model: 'claude-haiku-4-5', endpoint: 'anthropic' };
const LIDER = { role: 'lider' as const, mode: 'nuvem' as const, model: 'claude-sonnet-5', endpoint: 'anthropic' };
const providers = (esc = ESC) => ({ lider: LIDER, worker: LOCAL, esc });
const okOllama = createOllamaSupervisor({ fetch: (async () => new Response(JSON.stringify({ models: [{ name: 'qwen3.5:27b' }] }))) as never });
const tools = () => ({ android_conta1_get_screen_state: screenTool(() => SCREEN), android_conta1_tap_node: tapTool });

describe('runTask — incremento 2: provedor, piso e escalonamento', () => {
  it('piso em 3 inválidas → segundo generateText com o modelo de esc, histórico + nota, orçamento restante; task degraded', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const worker = new MockLanguageModelV4({ doGenerate: [calls({ id: 'c0', name: 'android_conta1_get_screen_state', input: {} }), invalid('c1'), invalid('c2'), invalid('c3'), text('nunca')] as never });
    const esc = new MockLanguageModelV4({ doGenerate: [text('resumo do escalonamento')] as never });
    const r = await runTask({ ...opts(db), providers: providers(), stepBudget: 10 }, { connect: mkMcp(tools()), model: worker, escModel: esc, ollama: okOllama });
    expect(r.outcome).toBe('done'); expect(r.summary).toBe('resumo do escalonamento');
    expect(r.degraded).toBe(true); expect(r.escalatedAtStep).toBe(4); expect(r.invalidCalls).toBe(3);
    expect(worker.doGenerateCalls).toHaveLength(4); expect(esc.doGenerateCalls).toHaveLength(1);
    const seen = esc.doGenerateCalls[0].prompt.map((m) => m.role);
    expect(seen[0]).toBe('system'); expect(seen).toContain('tool'); expect(seen[seen.length - 1]).toBe('user');
    const lastUser = esc.doGenerateCalls[0].prompt[esc.doGenerateCalls[0].prompt.length - 1] as { content: { text?: string }[] };
    expect(JSON.stringify(lastUser.content)).toMatch(/3 vez|falhou/);
    const t = db.prepare('select degraded, escalated_at_step, state from task where id=?').get(r.taskId) as { degraded: number; escalated_at_step: number; state: string };
    expect(t).toEqual({ degraded: 1, escalated_at_step: 4, state: 'done' });
    const provs = db.prepare('select provider, invalid_call from step where task_id=? order by idx').all(r.taskId) as { provider: string; invalid_call: number }[];
    expect(provs.map((p) => p.provider)).toEqual(['local:qwen3.5:27b', 'local:qwen3.5:27b', 'local:qwen3.5:27b', 'local:qwen3.5:27b', 'nuvem:claude-haiku-4-5']);
    expect(provs.filter((p) => p.invalid_call === 1)).toHaveLength(3);
  });
  it('sem esc na nuvem (esc local) → outcome quality-floor, task failed, identidade idle, sem segundo modelo', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const worker = new MockLanguageModelV4({ doGenerate: [invalid('c1'), invalid('c2'), invalid('c3'), text('nunca')] as never });
    const esc = new MockLanguageModelV4({ doGenerate: [text('não')] as never });
    const r = await runTask({ ...opts(db), providers: providers({ ...ESC, mode: 'local', endpoint: LOCAL.endpoint }) }, { connect: mkMcp(tools()), model: worker, escModel: esc, ollama: okOllama });
    expect(r.outcome).toBe('quality-floor'); expect(esc.doGenerateCalls).toHaveLength(0);
    expect(taskState(db, r.taskId)).toBe('failed'); expect(getIdentity(db, 'conta1')?.state).toBe('idle');
  });
  it('Ollama que não sobe → outcome infra (infra-local), task todo, identidade idle, modelo nunca chamado', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const worker = new MockLanguageModelV4({ doGenerate: [text('x')] as never });
    const dead = createOllamaSupervisor({ fetch: (async () => { throw new Error('ECONNREFUSED'); }) as never, sleep: async () => {}, timeoutMs: 1, logPath: '/dev/null', openLog: () => 'x', spawn: () => ({ pid: 1, kill: () => true, on: () => undefined }) });
    const r = await runTask({ ...opts(db), providers: providers() }, { connect: mkMcp(tools()), model: worker, ollama: dead });
    expect(r.outcome).toBe('infra'); expect(worker.doGenerateCalls).toHaveLength(0);
    expect(taskState(db, r.taskId)).toBe('todo'); expect(getIdentity(db, 'conta1')?.state).toBe('idle');
    expect(getIdentity(db, 'conta1')?.lastError).toMatch(/Ollama/);
  });
  it('kill switch durante o segmento 2 → killed com degraded preservado (Review Focus 3)', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    let killed = false;
    const worker = new MockLanguageModelV4({ doGenerate: [invalid('c1'), invalid('c2'), invalid('c3')] as never });
    const esc = new MockLanguageModelV4({ doGenerate: [
      { ...calls({ id: 'e1', name: 'android_conta1_get_screen_state', input: {} }) }, text('não chega'),
    ] as never });
    const r = await runTask({ ...opts(db), providers: providers(), isKilled: () => killed, onStep: () => { if (esc.doGenerateCalls.length > 0) killed = true; } }, { connect: mkMcp(tools()), model: worker, escModel: esc, ollama: okOllama });
    expect(r.outcome).toBe('killed'); expect(r.degraded).toBe(true);
    expect((db.prepare('select degraded from task where id=?').get(r.taskId) as { degraded: number }).degraded).toBe(1);
  });
  it('nuvem: providerOptions do anthropic continuam; local: providerOptions vazio e sem cacheControl', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const local = new MockLanguageModelV4({ doGenerate: [text('fim')] as never });
    await runTask({ ...opts(db), providers: providers() }, { connect: mkMcp(tools()), model: local, ollama: okOllama });
    expect(local.doGenerateCalls[0].providerOptions ?? {}).toEqual({});
    const cloud = new MockLanguageModelV4({ doGenerate: [text('fim')] as never });
    await runTask({ ...opts(db), providers: { ...providers(), worker: { ...ESC, role: 'worker' } } }, { connect: mkMcp(tools()), model: cloud });
    expect((cloud.doGenerateCalls[0].providerOptions as { anthropic: { cacheControl: unknown } }).anthropic.cacheControl).toEqual({ type: 'ephemeral', ttl: '1h' });
  });
  it('gen_ms vem do onLanguageModelCallEnd (performance.responseTimeMs) e o total sai em result.genMs', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const m = new MockLanguageModelV4({ doGenerate: [calls({ id: 'c0', name: 'android_conta1_get_screen_state', input: {} }), text('fim')] as never });
    const r = await runTask({ ...opts(db), providers: providers() }, { connect: mkMcp(tools()), model: m, ollama: okOllama });
    const g = db.prepare('select gen_ms from step where task_id=?').all(r.taskId) as { gen_ms: number | null }[];
    expect(g.every((x) => typeof x.gen_ms === 'number' && x.gen_ms >= 0)).toBe(true);
    expect(r.genMs).toBeGreaterThanOrEqual(0); expect(r.provider).toBe('local:qwen3.5:27b');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --project daemon daemon/test/record.test.ts daemon/test/real-sdk.test.ts`
Expected: FAIL — `record.test`: `provider` é `null`; `real-sdk`: `Cannot find module '../src/provider/ollama.js'` não ocorre (Task 4 existe) → falhas em `r.degraded` undefined / `providers` desconhecido / `outcome` errado.

- [ ] **Step 3: Implementar — `tasks.ts` e `record.ts`**

Em `daemon/src/db/tasks.ts`, substituir `finishStep` e acrescentar `markDegraded`:

```ts
export interface FinishStepPatch {
  resultExcerpt?: string; latencyMs?: number; error?: string; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number;
  provider?: string; genMs?: number | null; invalidCall?: boolean;
}
export function finishStep(db: DatabaseSync, stepId: number, p: FinishStepPatch): void {
  db.prepare(`update step set result_excerpt=coalesce(?, result_excerpt), latency_ms=coalesce(?, latency_ms), error=coalesce(?, error),
    input_tokens=coalesce(?, input_tokens), output_tokens=coalesce(?, output_tokens), cache_read_tokens=coalesce(?, cache_read_tokens),
    provider=coalesce(?, provider), gen_ms=coalesce(?, gen_ms), invalid_call=case when ? then 1 else invalid_call end, finished_at=datetime('now') where id=?`)
    .run(p.resultExcerpt ?? null, p.latencyMs ?? null, p.error ?? null, p.inputTokens ?? null, p.outputTokens ?? null, p.cacheReadTokens ?? null,
      p.provider ?? null, p.genMs ?? null, p.invalidCall ? 1 : 0, stepId);
}

export function markDegraded(db: DatabaseSync, taskId: string, atStep: number): void {
  db.prepare('update task set degraded=1, escalated_at_step=? where id=?').run(atStep, taskId);
}
```

Em `daemon/src/worker/record.ts`, `recordStep` passa a receber `extra` e marcar inválidas:

```ts
import { invalidCallIds } from '../provider/quality.js';

export interface StepExtra { readonly provider?: string; readonly genMs?: number | null }

export function recordStep(db: DatabaseSync, taskId: string, step: StepLike, pricing: Pricing, pending: Map<string, number> = new Map(), extra: StepExtra = {}): { costUsd: number } {
  const usage = readUsage(step.usage);
  const costUsd = costOf(step.usage, pricing);
  const rows = rowsFromContent(step);
  const invalid = new Set(invalidCallIds(step));
  const calls = rows.length ? rows : [{ id: `s${step.stepNumber}`, toolName: '(texto)', input: null, excerpt: squash(step.text, 300), error: null }];
  calls.forEach((c, i) => {
    const existing = pending.get(c.id);
    const id = existing ?? writeIntent(db, taskId, c.toolName, c.input, `${taskId}:${step.stepNumber}:${c.id}`);
    if (existing !== undefined) pending.delete(c.id);
    finishStep(db, id, {
      resultExcerpt: c.excerpt, error: c.error ?? undefined,
      inputTokens: i === 0 ? usage.inputTokens : 0, outputTokens: i === 0 ? usage.outputTokens : 0, cacheReadTokens: i === 0 ? usage.cacheReadTokens : 0,
      provider: extra.provider, genMs: i === 0 ? extra.genMs ?? null : null, invalidCall: invalid.has(c.id),
    });
  });
  addTaskCost(db, taskId, costUsd);
  return { costUsd };
}
```

(A importação de `quality.ts` em `record.ts` e de `record.ts` em `quality.ts` é circular só em tipos — `quality.ts` importa `type StepLike`; fica em `import type`, sem ciclo em runtime.)

- [ ] **Step 4: Implementar — `prompt.ts` e `run.ts`**

Em `daemon/src/worker/prompt.ts` acrescentar:

```ts
/** Mensagem que abre o segmento 2 (spec §5): o histórico não traz as tool calls inválidas (o SDK as descarta). */
export const ESCALATION_NOTE = (n: number, model: string): string =>
  `Continuação: o modelo anterior (${model}) falhou ${n} vezes ao chamar tools com argumentos válidos e foi substituído por você. ` +
  `Continue a mesma tarefa de onde a última tela parou. Leia a tela antes de agir. As regras de somente-leitura continuam valendo.`;
```

Reescrever `runTask` em `daemon/src/worker/run.ts` (o `wrapTools`, `classifyMcpError`, `readAllPages`, `mergeWindows` ficam como estão):

```ts
import { generateText, stepCountIs, tool, type LanguageModel, type ModelMessage, type StopCondition, type Tool, type ToolSet } from 'ai';
// ...imports existentes, remover createAnthropic; acrescentar:
import { providerLabel, readProviderConfig, type ProviderConfig, type ProviderRow } from '../provider/config.js';
import { ProviderError } from '../provider/errors.js';
import { buildModel as defaultBuildModel, pricingFor, providerOptionsFor } from '../provider/factory.js';
import { createOllamaSupervisor, type OllamaSupervisor } from '../provider/ollama.js';
import { createQualityFloor } from '../provider/quality.js';
import { markDegraded } from '../db/tasks.js';
import { ESCALATION_NOTE } from './prompt.js';

export interface RunTaskOpts {
  readonly db: DatabaseSync; readonly identity: IdentityRow; readonly goalText: string; readonly apiKey: string;
  readonly isKilled: () => boolean; readonly onStep: () => void; readonly stepBudget?: number;
  readonly providers?: ProviderConfig;
}
export interface RunTaskResult {
  readonly taskId: string; readonly outcome: 'done' | 'budget' | 'killed' | 'platform-block' | 'infra' | 'failed' | 'quality-floor';
  readonly costUsd: number; readonly usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
  readonly platformBlock: string | null; readonly summary: string;
  readonly degraded: boolean; readonly escalatedAtStep: number | null; readonly provider: string; readonly genMs: number; readonly invalidCalls: number;
}
export interface RunTaskDeps {
  readonly connect?: (url: string, token: string) => Promise<{ tools(): Promise<ToolSet>; close(): Promise<void> }>;
  readonly generate?: typeof generateText;
  readonly model?: LanguageModel;          // substitui o modelo do worker (testes)
  readonly escModel?: LanguageModel;       // substitui o modelo de escalonamento (testes)
  readonly ollama?: OllamaSupervisor;
  readonly buildModel?: typeof defaultBuildModel;
}

type Halt = { kind: 'platform-block' | 'auth' | 'infra' | 'infra-local'; text: string } | null;
```

Corpo novo de `runTask` (substitui o atual a partir de `const model: LanguageModel = ...` — a preparação de `client`, `mcpTools`, `ledgerTool`, `tools`, `stopIfHalted` continua igual e vem antes):

```ts
export async function runTask(o: RunTaskOpts, depsIn: RunTaskDeps = {}): Promise<RunTaskResult> {
  const deps = { connect: depsIn.connect ?? connectMcp, generate: depsIn.generate ?? generateText, buildModel: depsIn.buildModel ?? defaultBuildModel, ollama: depsIn.ollama ?? createOllamaSupervisor() };
  const { db, identity } = o;
  const budget = o.stepBudget ?? Number(process.env.ENXAME_STEP_BUDGET ?? CONFIG.worker.stepBudget);
  const cfg = o.providers ?? readProviderConfig(db);
  const { taskId } = createGoalAndTask(db, identity.id, o.goalText);
  setIdentityState(db, identity.id, 'running', { lastError: null });

  let lastScreen: ScreenState | null = null; let halt: Halt = null; let costUsd = 0; let genMsTotal = 0; let lastGenMs: number | null = null;
  let degraded = false; let escalatedAtStep: number | null = null; let stepsUsed = 0;
  const floor = createQualityFloor(CONFIG.worker.qualityFloor);
  const pending = new Map<string, number>();
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  const finish = (outcome: RunTaskResult['outcome'], summary: string): RunTaskResult => {
    const h = halt as Halt;
    const idState = h?.kind === 'platform-block' ? 'needs-human' : h && h.kind !== 'infra-local' ? 'offline' : 'idle';
    setIdentityState(db, identity.id, idState, { lastError: h?.text ?? (outcome === 'failed' || outcome === 'quality-floor' ? summary.slice(0, 200) : null) });
    const taskState = outcome === 'platform-block' ? 'needs-human' : outcome === 'failed' || outcome === 'quality-floor' ? 'failed'
      : outcome === 'infra' ? (h?.kind === 'auth' ? 'failed' : 'todo') : 'done';
    setTaskState(db, taskId, taskState);
    return { taskId, outcome, costUsd, usage, platformBlock: h?.kind === 'platform-block' ? h.text : null, summary,
      degraded, escalatedAtStep, provider: providerLabel(cfg.worker), genMs: genMsTotal, invalidCalls: floor.count() };
  };

  /** Um segmento = um generateText sobre `messages` com um papel do registro. */
  const segment = async (row: ProviderRow, model: LanguageModel, tools: ToolSet, messages: ModelMessage[], stopIfHalted: StopCondition<ToolSet>, slug: string | null, steps: number) =>
    deps.generate({
      model, tools, messages, instructions: SYSTEM_PROMPT,
      providerOptions: providerOptionsFor(row) as never,
      toolApproval: buildToolApproval(slug, () => lastScreen, 'read-only') as never,
      stopWhen: [stepCountIs(steps), stopIfHalted, () => floor.tripped() && row.role === 'worker'],
      prepareStep: ({ messages: m }) => ({ messages: pruneScreens(m, CONFIG.worker.keepScreens) }),
      onLanguageModelCallEnd: (e) => { lastGenMs = Math.round((e as { performance?: { responseTimeMs?: number } }).performance?.responseTimeMs ?? 0); },
      onStepFinish: (step) => {
        stepsUsed += 1;
        if (row.role === 'worker') floor.observe(step as unknown as StepLike);
        const r = recordStep(db, taskId, step as unknown as StepLike, pricingFor(row), pending, { provider: providerLabel(row), genMs: lastGenMs });
        costUsd += r.costUsd; genMsTotal += lastGenMs ?? 0; lastGenMs = null;
        const u = readUsage(step.usage as never); usage.inputTokens += u.inputTokens; usage.outputTokens += u.outputTokens; usage.cacheReadTokens += u.cacheReadTokens;
        o.onStep();
      },
    });

  let client: Awaited<ReturnType<typeof deps.connect>> | null = null;
  try {
    // Provedor local: o Ollama tem de estar de pé antes de abrir a conversa (falha aqui é infra-local, não do device).
    if (cfg.worker.mode === 'local') await deps.ollama.ensure(cfg.worker.endpoint, cfg.worker.model);
    const model = depsIn.model ?? deps.buildModel(cfg.worker, { anthropicApiKey: o.apiKey });

    client = await deps.connect(`http://127.0.0.1:${identity.mcpHostPort}/mcp`, identity.mcpToken);
    const slug = identity.deviceSlug || null;
    const mcpTools = wrapTools(pickWorkerTools(await client.tools(), slug), { db, taskId, pending,
      onScreen: (s) => { lastScreen = s; const b = s ? detectPlatformBlock(s) : null; if (b) halt = { kind: 'platform-block', text: b }; },
      onHalt: (h) => { halt = h; } });
    const ledgerTool = tool({ /* igual ao atual */ });
    const tools: ToolSet = { ...mcpTools, ledger_record: ledgerTool };
    const stopIfHalted: StopCondition<ToolSet> = () => halt !== null || o.isKilled();
    const messages: ModelMessage[] = [{ role: 'user', content: taskInstruction(o.goalText) }];

    let result = await segment(cfg.worker, model, tools, messages, stopIfHalted, slug, budget);

    if (floor.tripped() && !halt && !o.isKilled()) {
      const canEscalate = cfg.esc.mode === 'nuvem' && !!o.apiKey;
      if (!canEscalate) return finish('quality-floor', `piso de qualidade: ${floor.count()} tool calls inválidas com ${providerLabel(cfg.worker)}; sem escalonamento na nuvem`);
      degraded = true; escalatedAtStep = stepsUsed; markDegraded(db, taskId, stepsUsed);
      const escModel = depsIn.escModel ?? deps.buildModel(cfg.esc, { anthropicApiKey: o.apiKey });
      const continued: ModelMessage[] = [...messages, ...result.response.messages, { role: 'user', content: ESCALATION_NOTE(floor.count(), cfg.worker.model) }];
      result = await segment(cfg.esc, escModel, tools, continued, stopIfHalted, slug, Math.max(1, budget - stepsUsed));
    }

    const h = halt as Halt;
    if (h?.kind === 'platform-block') return finish('platform-block', result.text);
    if (h) return finish('infra', result.text);
    if (o.isKilled()) return finish('killed', result.text);
    return finish(stepsUsed >= budget ? 'budget' : 'done', result.text);
  } catch (e) {
    const h = halt as Halt;
    if (h?.kind === 'platform-block') return finish('platform-block', String((e as Error).message ?? e));
    if (h) return finish('infra', String((e as Error).message ?? e));
    if (ProviderError.isInstance(e)) { halt = { kind: e.kind, text: e.message }; return finish(e.kind === 'auth' ? 'failed' : 'infra', e.message); }
    return finish('failed', String((e as Error).message ?? e));
  } finally {
    await client?.close().catch(() => undefined);
  }
}
```

Em `daemon/src/config.ts`: `worker: { stepBudget: 30, keepScreens: 2, qualityFloor: 3 }` e remover `models` (agora vem do registro) — se algo ainda importar `CONFIG.models`, o `tsc` acusa; corrigir o importador para o registro.

Notas para o executor:
- `finish('infra')` com `halt.kind === 'infra-local'` deve deixar a identidade **`idle`** e a tarefa **`todo`** (tabela §7 do spec) — por isso o `idState` trata `infra-local` separado de `infra`.
- No teste "Ollama que não sobe", `lastError` deve conter "Ollama": vem de `ProviderError.message`.
- `stepsUsed >= budget` substitui `result.steps.length >= budget` porque agora há dois segmentos.

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run --project daemon daemon/test/record.test.ts daemon/test/real-sdk.test.ts && npx vitest run && npx tsc -p tsconfig.daemon.json --noEmit`
Expected: PASS (7 novos; suíte inteira verde — os testes antigos de `real-sdk` passam `model` e não passam `providers`, então usam `readProviderConfig` = nuvem, sem Ollama); tsc limpo

- [ ] **Step 6: Commit**

```bash
git add daemon/src/db/tasks.ts daemon/src/worker/record.ts daemon/src/worker/prompt.ts daemon/src/worker/run.ts daemon/src/config.ts daemon/test/record.test.ts daemon/test/real-sdk.test.ts
git commit -m "feat(worker): modelo pela fábrica de provedores, piso de qualidade e escalonamento na mesma conversa"
```

---

### Task 6: Teste de conexão (`probe.ts`)

**Files:**
- Create: `daemon/src/provider/probe.ts`
- Test: `daemon/test/provider-probe.test.ts`

**Interfaces:**
- Consumes: `ProviderRow`, `readProviderConfig` (T1); `buildModel` (T3); `OllamaSupervisor` (T4); `connectMcp`, `pickWorkerTools`, `toolPrefix`; `ensureIdentityReady` não é chamado aqui (é responsabilidade do chamador — Task 7).
- Produces:
  - `interface ProviderTest { readonly role: RoleKey; readonly model: string; readonly latencyMs: number; readonly tokensPerSec: number | null; readonly argsValid: boolean; readonly warning: string | null; readonly error: string | null; readonly at: string }`.
  - `interface ProbeDeps { connect?; generate?; model?: LanguageModel; ollama?: OllamaSupervisor; buildModel? }`.
  - `testProvider(db, row: ProviderRow, identity: IdentityRow, env: { anthropicApiKey?: string }, deps?: ProbeDeps): Promise<ProviderTest>` — nunca lança; erro vai em `error`; grava sempre em `provider_test`.
  - `lastProviderTests(db): Readonly<Partial<Record<RoleKey, ProviderTest>>>`.

- [ ] **Step 1: Teste (falha)**

`daemon/test/provider-probe.test.ts`:

```ts
import { tool } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { openDb } from '../src/db/open.js';
import { upsertIdentity } from '../src/db/identities.js';
import { createOllamaSupervisor } from '../src/provider/ollama.js';
import { lastProviderTests, testProvider } from '../src/provider/probe.js';

const row = { id: 'conta1', name: 'conta1', handle: '@a', avdName: 'x', serial: 's', consolePort: 5554, mcpHostPort: 8080, mcpToken: 't', deviceSlug: 'conta1', appPackage: 'p', appVersionName: '1', state: 'idle' as const };
const LOCAL = { role: 'worker' as const, mode: 'local' as const, model: 'qwen3.5:27b', endpoint: 'http://127.0.0.1:11434/v1' };
const usage = { inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 40, text: 40, reasoning: 0 } };
const screenCall = (input: string) => ({ content: [{ type: 'tool-call' as const, toolCallId: 'c1', toolName: 'android_conta1_get_screen_state', input }], finishReason: { unified: 'tool-calls' as const }, usage, warnings: [] });
const SCREEN = 'screen:1080x2400 density:420 orientation:portrait\n--- window:1 type:APPLICATION pkg:p title:t layer:0 focused:true ---\nnode_id\tclass\ttext\tdesc\tres_id\tbounds\tflags\nn1\tTextView\tx\t-\t-\t0,0,1,1\ton\n';
const seen: string[] = [];
const connect = async () => ({ tools: async () => ({
  android_conta1_get_screen_state: tool({ description: 't', inputSchema: z.object({ include_screenshot: z.boolean().optional() }), execute: async () => { seen.push('screen'); return SCREEN; } }),
  android_conta1_tap_node: tool({ description: 't', inputSchema: z.object({ node_id: z.string() }), execute: async () => { seen.push('tap'); return 'no'; } }),
}), close: async () => {} });
const sup = (spawned: boolean) => createOllamaSupervisor({ fetch: (async () => new Response(JSON.stringify({ models: [{ name: 'qwen3.5:27b' }] }))) as never, spawn: () => ({ pid: 9, kill: () => true, on: () => undefined }), sleep: async () => {} , ...(spawned ? {} : {}) });

describe('testProvider', () => {
  it('chama só get_screen_state com toolChoice required, mede e grava provider_test', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const model = new MockLanguageModelV4({ doGenerate: [screenCall('{}')] as never });
    const t = await testProvider(db, LOCAL, row, {}, { connect, model, ollama: sup(false) });
    expect(t).toMatchObject({ role: 'worker', model: 'qwen3.5:27b', argsValid: true, error: null });
    expect(t.latencyMs).toBeGreaterThanOrEqual(0);
    expect(model.doGenerateCalls[0].toolChoice).toEqual({ type: 'required' });
    expect(model.doGenerateCalls[0].tools?.map((x) => x.name)).toEqual(['android_conta1_get_screen_state']);
    expect(seen).toEqual(['screen']);
    expect(lastProviderTests(db).worker).toMatchObject({ argsValid: true });
    expect((db.prepare('select count(*) as n from step').get() as { n: number }).n).toBe(0);
  });
  it('argumentos inválidos → argsValid false, sem erro', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const model = new MockLanguageModelV4({ doGenerate: [screenCall('{not json')] as never });
    const t = await testProvider(db, LOCAL, row, {}, { connect, model, ollama: sup(false) });
    expect(t.argsValid).toBe(false); expect(t.error).toBeNull();
  });
  it('Ollama externo (não subido pelo daemon) → warning de contexto desconhecido (Review Focus 1)', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const model = new MockLanguageModelV4({ doGenerate: [screenCall('{}')] as never });
    const t = await testProvider(db, LOCAL, row, {}, { connect, model, ollama: sup(false) });
    expect(t.warning).toMatch(/contexto desconhecido/);
  });
  it('Ollama sem o modelo → error infra-local com instrução de pull, gravado', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const missing = createOllamaSupervisor({ fetch: (async () => new Response(JSON.stringify({ models: [{ name: 'gemma4:12b' }] }))) as never });
    const t = await testProvider(db, LOCAL, row, {}, { connect, model: new MockLanguageModelV4({ doGenerate: [] as never }), ollama: missing });
    expect(t.argsValid).toBe(false); expect(t.error).toMatch(/ollama pull qwen3\.5:27b/);
    expect((db.prepare('select error from provider_test').get() as { error: string }).error).toMatch(/pull/);
  });
  it('nuvem sem chave → error auth', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const t = await testProvider(db, { role: 'esc', mode: 'nuvem', model: 'claude-haiku-4-5', endpoint: 'anthropic' }, row, {}, { connect });
    expect(t.error).toMatch(/ANTHROPIC_API_KEY/); expect(t.argsValid).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --project daemon daemon/test/provider-probe.test.ts`
Expected: FAIL — `Cannot find module '../src/provider/probe.js'`

- [ ] **Step 3: Implementar**

`daemon/src/provider/probe.ts`:

```ts
import { generateText, stepCountIs, type LanguageModel, type ToolSet } from 'ai';
import type { DatabaseSync } from 'node:sqlite';
import type { IdentityRow } from '../db/identities.js';
import { connectMcp } from '../device/mcp.js';
import { toolPrefix } from '../worker/tools.js';
import { providerLabel, ROLE_KEYS, type ProviderRow, type RoleKey } from './config.js';
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
```

`providerLabel` importado sem uso → remover a importação se o `tsc` (noUnusedLocals) reclamar.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run --project daemon daemon/test/provider-probe.test.ts && npx tsc -p tsconfig.daemon.json --noEmit`
Expected: PASS (5); tsc limpo. Se `toolChoice: 'required'` chegar ao mock como `{ type: 'required' }` (esperado) o teste passa; se chegar como string, ajustar a asserção para o shape real e registrar no ledger.

- [ ] **Step 5: Commit**

```bash
git add daemon/src/provider/probe.ts daemon/test/provider-probe.test.ts
git commit -m "feat(provider): teste de conexão — tool-call canônico medido e gravado por papel"
```

---

### Task 7: API `/providers`, snapshot e ligação no daemon

**Files:**
- Modify: `daemon/src/server/api.ts`
- Modify: `daemon/src/server/snapshot.ts`
- Modify: `daemon/src/index.ts`
- Test: `daemon/test/server.test.ts` (novo `describe`)

**Interfaces:**
- Consumes: `readProviderConfig`, `updateProvider`, `ProviderPatch`, `ROLE_KEYS` (T1); `testProvider`, `lastProviderTests`, `ProviderTest` (T6); `OllamaSupervisor.stop` (T4).
- Produces:
  - `ServerOpts` ganha `onProviderTest: (role: RoleKey) => Promise<ProviderTest>`.
  - `GET /providers` → `{ config: ProviderConfig, tests: Partial<Record<RoleKey, ProviderTest>> }`.
  - `PUT /providers/:role` (body `ProviderPatch`) → 200 `ProviderRow`; 400 inválido; 404 papel desconhecido; **409 se há objetivo ou teste em execução**.
  - `POST /providers/:role/test` → 200 `ProviderTest`; 409 se há objetivo/teste em execução; 404 papel desconhecido.
  - `FleetSnapshot.providers: Record<RoleKey, ProviderRow & { lastTest: ProviderTest | null }>`; `ToolRow` ganha `provider: string | null`; `IdentitySnapshot` ganha `degraded: boolean; genMs: number`; `BUDGET` lê `ENXAME_STEP_BUDGET`.

- [ ] **Step 1: Teste (falha)**

Acrescentar em `daemon/test/server.test.ts`:

```ts
describe('servidor — provedores (incremento 2)', () => {
  const h = { authorization: 'Bearer seg', 'content-type': 'application/json' };
  const mk = async (db = openDb(':memory:'), onGoal: () => Promise<void> = async () => {}) => {
    const tests: string[] = [];
    const s = await startServer({ db, port: 0, token: 'seg', onGoal, onKill: () => {},
      onProviderTest: async (role) => { tests.push(role); return { role, model: 'm', latencyMs: 1, tokensPerSec: 2, argsValid: true, warning: null, error: null, at: 'x' }; } });
    stop = s.close; return { s, db, tests };
  };
  it('GET /providers devolve config semeada + últimos testes; PUT valida e aplica', async () => {
    const { s } = await mk();
    const g = await (await fetch(`http://127.0.0.1:${s.port}/providers`, { headers: h })).json() as { config: { worker: { mode: string } }; tests: object };
    expect(g.config.worker.mode).toBe('nuvem'); expect(g.tests).toEqual({});
    const put = await fetch(`http://127.0.0.1:${s.port}/providers/worker`, { method: 'PUT', headers: h, body: JSON.stringify({ mode: 'local', model: 'qwen3.5:27b' }) });
    expect(put.status).toBe(200); expect(await put.json()).toMatchObject({ mode: 'local', model: 'qwen3.5:27b', endpoint: 'http://127.0.0.1:11434/v1' });
    expect((await fetch(`http://127.0.0.1:${s.port}/providers/worker`, { method: 'PUT', headers: h, body: JSON.stringify({ mode: 'x' }) })).status).toBe(400);
    expect((await fetch(`http://127.0.0.1:${s.port}/providers/chefe`, { method: 'PUT', headers: h, body: '{}' })).status).toBe(404);
  });
  it('POST /providers/:role/test chama onProviderTest e devolve o resultado; snapshot traz providers', async () => {
    const { s, tests } = await mk();
    const r = await fetch(`http://127.0.0.1:${s.port}/providers/worker/test`, { method: 'POST', headers: h });
    expect(r.status).toBe(200); expect(await r.json()).toMatchObject({ role: 'worker', argsValid: true }); expect(tests).toEqual(['worker']);
    const snap = await (await fetch(`http://127.0.0.1:${s.port}/state`, { headers: h })).json() as { providers: { worker: { mode: string; lastTest: unknown } } };
    expect(snap.providers.worker.mode).toBe('nuvem');
  });
  it('PUT e test → 409 enquanto um objetivo roda (Review Focus 4)', async () => {
    let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
    const { s } = await mk(openDb(':memory:'), () => gate);
    await fetch(`http://127.0.0.1:${s.port}/goals`, { method: 'POST', headers: h, body: JSON.stringify({ text: 'objetivo um' }) });
    expect((await fetch(`http://127.0.0.1:${s.port}/providers/worker`, { method: 'PUT', headers: h, body: JSON.stringify({ model: 'outro' }) })).status).toBe(409);
    expect((await fetch(`http://127.0.0.1:${s.port}/providers/worker/test`, { method: 'POST', headers: h })).status).toBe(409);
    release();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --project daemon daemon/test/server.test.ts`
Expected: FAIL — 404 em `/providers`; tsc do teste reclama de `onProviderTest` desconhecido em `ServerOpts` (vitest não tipa; a falha real é o 404)

- [ ] **Step 3: Implementar**

`daemon/src/server/api.ts` — acrescentar imports e rotas:

```ts
import { ProviderPatch, readProviderConfig, ROLE_KEYS, updateProvider, type RoleKey } from '../provider/config.js';
import { lastProviderTests, type ProviderTest } from '../provider/probe.js';

export interface ServerOpts {
  readonly db: DatabaseSync; readonly port?: number; readonly token: string;
  readonly onGoal: (text: string) => Promise<void>; readonly onKill: () => void;
  readonly onProviderTest: (role: RoleKey) => Promise<ProviderTest>;
}
const isRole = (x: string): x is RoleKey => (ROLE_KEYS as readonly string[]).includes(x);
```

Dentro do handler, depois da rota `/resume`:

```ts
    const prov = /^\/providers(?:\/([a-z]+))?(\/test)?$/.exec(url.pathname);
    if (prov) {
      const [, role, isTest] = prov;
      if (req.method === 'GET' && !role) return send(res, 200, { config: readProviderConfig(o.db), tests: lastProviderTests(o.db) });
      if (!role || !isRole(role)) return send(res, 404, { error: 'papel desconhecido' });
      if (inFlight) return send(res, 409, { error: 'objetivo ou teste em execução; troca de provedor só com a frota parada' });
      if (req.method === 'PUT' && !isTest) {
        const parsed = ProviderPatch.safeParse(await readJson(req));
        if (!parsed.success) return send(res, 400, { error: parsed.error.issues.map((i) => i.message) });
        return send(res, 200, updateProvider(o.db, role, parsed.data));
      }
      if (req.method === 'POST' && isTest) {
        inFlight = true;
        try { return send(res, 200, await o.onProviderTest(role)); }
        catch (e) { return send(res, 500, { error: String((e as Error).message ?? e) }); }
        finally { inFlight = false; }
      }
    }
```

`daemon/src/server/snapshot.ts`:

```ts
import { readProviderConfig, type ProviderRow, type RoleKey } from '../provider/config.js';
import { lastProviderTests, type ProviderTest } from '../provider/probe.js';

export interface ToolRow { readonly idx: number; readonly tool: string; readonly excerpt: string; readonly tokens: number; readonly gate: boolean; readonly provider: string | null }
export interface IdentitySnapshot { /* campos atuais */ readonly degraded: boolean; readonly genMs: number }
export type ProviderSnapshot = ProviderRow & { readonly lastTest: ProviderTest | null };
export interface FleetSnapshot { readonly identities: readonly IdentitySnapshot[]; readonly providers: Readonly<Record<RoleKey, ProviderSnapshot>>; readonly killed: boolean; readonly updatedAt: string }

const BUDGET = Number(process.env.ENXAME_STEP_BUDGET ?? 30);
```

Na consulta da tarefa acrescentar `degraded`; na de steps acrescentar `provider`; e `genMs = sum(gen_ms)`. Montar `providers`:

```ts
  const cfg = readProviderConfig(db); const tests = lastProviderTests(db);
  const providers = Object.fromEntries((Object.keys(cfg) as RoleKey[]).map((k) => [k, { ...cfg[k], lastTest: tests[k] ?? null }])) as Record<RoleKey, ProviderSnapshot>;
  return { identities, providers, killed, updatedAt: new Date().toISOString() };
```

`daemon/src/index.ts` — depois de `const adb = createAdb();`:

```ts
import { createOllamaSupervisor } from './provider/ollama.js';
import { testProvider } from './provider/probe.js';
import { readProviderConfig } from './provider/config.js';
import { ensureIdentityReady } from './fleet/identity.js';

const ollama = createOllamaSupervisor();
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { ollama.stop(); process.exit(0); });
process.on('exit', () => ollama.stop());
```

e em `startServer`:

```ts
  onProviderTest: async (role) => {
    const id = getIdentity(db, 'conta1')!;
    const probe = await ensureIdentityReady(db, id, { adb }); server.broadcast();
    if (!probe.ready) return { role, model: readProviderConfig(db)[role].model, latencyMs: 0, tokensPerSec: null, argsValid: false, warning: null, error: `identidade não pronta: ${probe.details.join('; ')}`, at: new Date().toISOString() };
    const t = await testProvider(db, readProviderConfig(db)[role], getIdentity(db, 'conta1')!, { anthropicApiKey: env.anthropicApiKey }, { ollama });
    server.broadcast(); return t;
  },
```

e `runTask(...)` recebe `{ ollama }` como deps: `await runTask({ ... }, { ollama });`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run && npx tsc -p tsconfig.daemon.json --noEmit`
Expected: PASS (3 novos; `server.test.ts` antigo continua verde — os `startServer` antigos precisam ganhar `onProviderTest: async () => { throw new Error('n/a'); }` ou o tipo reclama; atualizar os 4 chamadores existentes no teste); tsc limpo

- [ ] **Step 5: Commit**

```bash
git add daemon/src/server/api.ts daemon/src/server/snapshot.ts daemon/src/index.ts daemon/test/server.test.ts
git commit -m "feat(daemon): rotas /providers, provedores no snapshot e supervisor do Ollama no ciclo de vida"
```

---

### Task 8: Ponte Electron e tela Provedores viva

**Files:**
- Modify: `electron/daemon-bridge.ts` (`request` genérico), `electron/main.ts` (2 handlers), `electron/preload.ts` (2 métodos)
- Modify: `src/live/types.ts`, `src/live/merge.ts`, `src/App.tsx`, `src/state/useFleet.ts`
- Test: `src/live/merge.test.ts` (novo `describe`)

**Interfaces:**
- Consumes: shape de `FleetSnapshot.providers` e `ProviderTest` (T7), `RoleVM`/`selectRoles` (existentes).
- Produces:
  - `EnxameBridge` ganha `setProvider(role: RoleKey, patch: { mode?: 'nuvem' | 'local'; model?: string; endpoint?: string }): Promise<void>` e `testProvider(role: RoleKey): Promise<LiveProviderTest>`.
  - `liveRoles(roles: readonly RoleVM[], live: FleetSnapshot | null): readonly RoleVM[]` em `merge.ts` — sobrepõe `mode`, `model`, `endpoint` do snapshot e, quando `lastTest` existe e a tela não está testando, `result` com 4 linhas: Latência, Tokens/s, Argumentos (`estruturados e válidos` | `inválidos`), Aviso/Erro (ou `Tool` como hoje quando limpo).
  - `request(info, method, pathname, body?): Promise<unknown>` em `daemon-bridge.ts`.

- [ ] **Step 1: Teste (falha)**

Acrescentar em `src/live/merge.test.ts`:

```ts
import { liveRoles } from './merge';
import type { RoleVM } from '../state/selectors';

const roles: readonly RoleVM[] = [
  { key: 'lider', name: 'Líder', volume: 'v', tone: 'grey', mode: 'nuvem', model: 'Claude Sonnet', endpoint: 'api.anthropic.com', testLabel: 'Testar conexão', testing: false, result: null },
  { key: 'worker', name: 'Worker', volume: 'v', tone: 'green', mode: 'local', model: 'mock', endpoint: 'mock', testLabel: 'Testar conexão', testing: false, result: null },
  { key: 'esc', name: 'Esc', volume: 'v', tone: 'dark', mode: 'nuvem', model: 'mock', endpoint: 'mock', testLabel: 'Testar conexão', testing: false, result: null },
];
const snap = { ...live, providers: {
  lider: { role: 'lider', mode: 'nuvem', model: 'claude-sonnet-5', endpoint: 'anthropic', lastTest: null },
  worker: { role: 'worker', mode: 'local', model: 'qwen3.5:27b', endpoint: 'http://127.0.0.1:11434/v1', lastTest: { role: 'worker', model: 'qwen3.5:27b', latencyMs: 812, tokensPerSec: 41.3, argsValid: true, warning: null, error: null, at: 'x' } },
  esc: { role: 'esc', mode: 'nuvem', model: 'claude-haiku-4-5', endpoint: 'anthropic', lastTest: { role: 'esc', model: 'claude-haiku-4-5', latencyMs: 0, tokensPerSec: null, argsValid: false, warning: null, error: 'auth: ANTHROPIC_API_KEY ausente', at: 'x' } },
} } as const;

describe('liveRoles', () => {
  it('sem snapshot devolve o mock intacto', () => { expect(liveRoles(roles, null)).toBe(roles); });
  it('sobrepõe modo/modelo/endpoint e traduz o último teste em linhas', () => {
    const out = liveRoles(roles, snap as never);
    expect(out[1]).toMatchObject({ mode: 'local', model: 'qwen3.5:27b', endpoint: 'http://127.0.0.1:11434/v1' });
    expect(out[1].result).toEqual([{ label: 'Latência', value: '812 ms' }, { label: 'Tokens/s', value: '41,3' }, { label: 'Argumentos', value: 'estruturados e válidos' }, { label: 'Tool', value: 'android_conta1_get_screen_state' }]);
    expect(out[2].result?.[3]).toEqual({ label: 'Erro', value: 'auth: ANTHROPIC_API_KEY ausente' });
    expect(out[0].result).toBeNull();
    expect(roles[1].model).toBe('mock');
  });
  it('enquanto testing=true não sobrepõe o resultado antigo', () => {
    const out = liveRoles(roles.map((r) => ({ ...r, testing: true })), snap as never);
    expect(out[1].result).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --project renderer src/live/merge.test.ts`
Expected: FAIL — `liveRoles` não exportado

- [ ] **Step 3: Implementar**

`src/live/types.ts` — acrescentar:

```ts
export type LiveRoleKey = 'lider' | 'worker' | 'esc';
export interface LiveProviderTest { readonly role: LiveRoleKey; readonly model: string; readonly latencyMs: number; readonly tokensPerSec: number | null; readonly argsValid: boolean; readonly warning: string | null; readonly error: string | null; readonly at: string }
export interface LiveProvider { readonly role: LiveRoleKey; readonly mode: 'nuvem' | 'local'; readonly model: string; readonly endpoint: string; readonly lastTest: LiveProviderTest | null }
export interface FleetSnapshot { readonly identities: readonly LiveIdentity[]; readonly providers?: Readonly<Record<LiveRoleKey, LiveProvider>>; readonly killed: boolean; readonly updatedAt: string }
export interface EnxameBridge {
  readonly onSnapshot: (cb: (s: FleetSnapshot) => void) => () => void;
  readonly startGoal: (text: string) => Promise<void>;
  readonly kill: () => Promise<void>;
  readonly setProvider: (role: LiveRoleKey, patch: { mode?: 'nuvem' | 'local'; model?: string; endpoint?: string }) => Promise<void>;
  readonly testProvider: (role: LiveRoleKey) => Promise<LiveProviderTest>;
}
```

`src/live/merge.ts` — acrescentar:

```ts
import type { RoleVM, TestResultRow } from '../state/selectors';
import type { LiveProviderTest } from './types';

const fmtTps = (n: number | null) => (n === null ? '—' : n.toFixed(1).replace('.', ','));
export function testRows(t: LiveProviderTest): readonly TestResultRow[] {
  const last: TestResultRow = t.error ? { label: 'Erro', value: t.error } : t.warning ? { label: 'Aviso', value: t.warning } : { label: 'Tool', value: 'android_conta1_get_screen_state' };
  return [{ label: 'Latência', value: `${t.latencyMs} ms` }, { label: 'Tokens/s', value: fmtTps(t.tokensPerSec) }, { label: 'Argumentos', value: t.argsValid ? 'estruturados e válidos' : 'inválidos' }, last];
}

/** Sobrepõe o registro real de provedores à tela; sem snapshot (Vite no browser) tudo segue mock. */
export function liveRoles(roles: readonly RoleVM[], live: FleetSnapshot | null): readonly RoleVM[] {
  const p = live?.providers; if (!p) return roles;
  return roles.map((r) => {
    const l = p[r.key]; if (!l) return r;
    return { ...r, mode: l.mode, model: l.model, endpoint: l.endpoint, result: r.testing ? r.result : l.lastTest ? testRows(l.lastTest) : null };
  });
}
```

`TestResultRow` hoje está em `src/data/providers.ts` e é reexportado por `selectors.ts`? Se não for, importar de `../data/providers`.

`electron/daemon-bridge.ts` — acrescentar:

```ts
export async function request(info: Info, method: 'PUT' | 'POST', pathname: string, body?: unknown): Promise<unknown> {
  const r = await fetch(`http://127.0.0.1:${info.port}${pathname}`, { method, headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const json = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${pathname} → ${r.status}: ${JSON.stringify(json)}`);
  return json;
}
```

`electron/main.ts` — junto dos outros `ipcMain.handle`:

```ts
    ipcMain.handle('enxame:setProvider', (_e, role: string, patch: unknown) => request(info, 'PUT', `/providers/${role}`, patch));
    ipcMain.handle('enxame:testProvider', (_e, role: string) => request(info, 'POST', `/providers/${role}/test`));
```

`electron/preload.ts` — dentro de `exposeInMainWorld`:

```ts
  setProvider: (role: string, patch: unknown) => ipcRenderer.invoke('enxame:setProvider', role, patch),
  testProvider: (role: string) => ipcRenderer.invoke('enxame:testProvider', role),
```

`src/state/useFleet.ts` — o `testConnection` com bridge deixa de usar o timer: em `actions`, substituir por

```ts
      testConnection: (role) => {
        dispatch({ type: 'testStart', role });
        const bridge = window.enxame;
        if (!bridge?.testProvider) return; // sem daemon: o efeito com TEST_MS conclui o mock
        bridge.testProvider(role).catch(() => undefined).finally(() => dispatch({ type: 'testDone', role }));
      },
      pickMode: (role, mode) => { window.enxame?.setProvider?.(role, { mode }).catch(() => undefined); dispatch({ type: 'pickMode', role, mode }); },
```

e no efeito do timer, pular quando `window.enxame?.testProvider` existe. `src/App.tsx`: `roles={liveRoles(selectRoles(state), live)}`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run && npx tsc -b --noEmit && npx tsc -p tsconfig.electron.json --noEmit`
Expected: PASS (3 novos); ambos os tsc limpos

- [ ] **Step 5: Verificação visual (não bloqueia o commit)**

Run: `npm run daemon:build && npm run electron:dev` (com `--no-sandbox` se necessário) → tela Provedores mostra `worker · Nuvem · claude-haiku-4-5`; clicar em Local muda e persiste após recarregar; "Testar conexão" no `esc` mostra latência real.
Expected: valores do registro, não do mock.

- [ ] **Step 6: Commit**

```bash
git add electron/daemon-bridge.ts electron/main.ts electron/preload.ts src/live/types.ts src/live/merge.ts src/live/merge.test.ts src/state/useFleet.ts src/App.tsx
git commit -m "feat(ui): tela Provedores ligada ao registro real — modo, modelo, endpoint e teste de conexão pelo daemon"
```

---

### Task 9: `bench.ts` — bake-off, corrida, amostrador de VRAM e relatório

**Files:**
- Create: `daemon/src/bench/stats.ts` (`median`, `renderBakeoffTable`, `renderComparison`)
- Create: `daemon/src/bench/vram.ts` (`startVramSampler`)
- Create: `daemon/src/cli/bench.ts`
- Modify: `package.json` (script `bench`)
- Test: `daemon/test/bench.test.ts`

**Interfaces:**
- Consumes: `testProvider` (T6), `updateProvider`/`readProviderConfig` (T1), `runTask` (T5), `createOllamaSupervisor` (T4), `ensureIdentityReady`.
- Produces:
  - `median(xs: readonly number[]): number` (mediana; lista vazia → `NaN`).
  - `interface BakeoffRow { model: string; latencyMs: number; tokensPerSec: number | null; argsValid: number; runs: number; eliminated: boolean; reason: string | null }`.
  - `pickWinner(rows: readonly BakeoffRow[]): BakeoffRow | null` — só `argsValid === runs`; desempate por `tokensPerSec` desc.
  - `renderBakeoffTable(rows): string`; `interface RunSummary { label; outcome; steps; elapsedS; genS; inTok; outTok; cacheRead; invalidCalls; degraded; escalatedAtStep; earlyStopRemaining; costUsd; vramPeakMiB; platformBlock; summary }`; `renderComparison(local: RunSummary, cloud: RunSummary): string`.
  - `startVramSampler(exec, everyMs): { stop(): number /* pico em MiB */ }`.
  - `npm run bench` → `node --env-file=.env dist-daemon/cli/bench.ts` com envs `BENCH_MODELS` (lista separada por vírgula; default os 4), `BENCH_SKIP_CLOUD=1` para não repetir o Haiku.

- [ ] **Step 1: Teste (falha)**

`daemon/test/bench.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { median, pickWinner, renderBakeoffTable, renderComparison, type BakeoffRow, type RunSummary } from '../src/bench/stats.js';
import { startVramSampler } from '../src/bench/vram.js';

const row = (model: string, tps: number | null, argsValid: number, runs = 3): BakeoffRow => ({ model, latencyMs: 1000, tokensPerSec: tps, argsValid, runs, eliminated: argsValid < runs, reason: argsValid < runs ? 'args inválidos' : null });

describe('bench/stats', () => {
  it('median', () => { expect(median([3, 1, 2])).toBe(2); expect(median([4, 1, 3, 2])).toBe(2.5); expect(Number.isNaN(median([]))).toBe(true); });
  it('pickWinner exige args válidos em todas as rodadas e desempata por tok/s', () => {
    expect(pickWinner([row('a', 50, 2), row('b', 30, 3), row('c', 40, 3)])?.model).toBe('c');
    expect(pickWinner([row('a', 50, 2)])).toBeNull();
  });
  it('tabelas são markdown com uma linha por modelo/métrica', () => {
    const t = renderBakeoffTable([row('a', 50, 3), row('b', null, 1)]);
    expect(t).toMatch(/\| a \| 1000 \| 50 \| 3\/3 \| — \|/); expect(t).toMatch(/\| b \| 1000 \| — \| 1\/3 \| eliminado: args inválidos \|/);
    const s = (label: string): RunSummary => ({ label, outcome: 'done', steps: 30, elapsedS: 57, genS: 12.3, inTok: 1, outTok: 2, cacheRead: 3, invalidCalls: 0, degraded: false, escalatedAtStep: null, earlyStopRemaining: 0, costUsd: 0.21, vramPeakMiB: 21000, platformBlock: null, summary: 'ok' });
    const c = renderComparison(s('local'), s('haiku'));
    expect(c).toMatch(/\| passos \| 30 \| 30 \|/); expect(c).toMatch(/s·GPU/); expect(c).toMatch(/VRAM/);
  });
});

describe('bench/vram', () => {
  it('amostra nvidia-smi e devolve o pico ao parar', async () => {
    const outs = ['3500', '21000', '18000']; let i = 0;
    const s = startVramSampler(async () => outs[Math.min(i++, outs.length - 1)], 1);
    await new Promise((r) => setTimeout(r, 30));
    expect(s.stop()).toBe(21000);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --project daemon daemon/test/bench.test.ts`
Expected: FAIL — `Cannot find module '../src/bench/stats.js'`

- [ ] **Step 3: Implementar**

`daemon/src/bench/stats.ts`:

```ts
export function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface BakeoffRow { readonly model: string; readonly latencyMs: number; readonly tokensPerSec: number | null; readonly argsValid: number; readonly runs: number; readonly eliminated: boolean; readonly reason: string | null }

export function pickWinner(rows: readonly BakeoffRow[]): BakeoffRow | null {
  const ok = rows.filter((r) => !r.eliminated && r.argsValid === r.runs);
  return [...ok].sort((a, b) => (b.tokensPerSec ?? -1) - (a.tokensPerSec ?? -1))[0] ?? null;
}

const num = (n: number | null) => (n === null || Number.isNaN(n) ? '—' : String(Math.round(n * 10) / 10));

export function renderBakeoffTable(rows: readonly BakeoffRow[]): string {
  return ['| modelo | latência mediana (ms) | tok/s | args válidos | status |', '|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.model} | ${num(r.latencyMs)} | ${num(r.tokensPerSec)} | ${r.argsValid}/${r.runs} | ${r.eliminated ? `eliminado: ${r.reason}` : '—'} |`)].join('\n');
}

export interface RunSummary {
  readonly label: string; readonly outcome: string; readonly steps: number; readonly elapsedS: number; readonly genS: number;
  readonly inTok: number; readonly outTok: number; readonly cacheRead: number; readonly invalidCalls: number; readonly degraded: boolean;
  readonly escalatedAtStep: number | null; readonly earlyStopRemaining: number; readonly costUsd: number; readonly vramPeakMiB: number | null;
  readonly platformBlock: string | null; readonly summary: string;
}

export function renderComparison(a: RunSummary, b: RunSummary): string {
  const line = (k: string, f: (s: RunSummary) => string | number) => `| ${k} | ${f(a)} | ${f(b)} |`;
  return [`| métrica | ${a.label} | ${b.label} |`, '|---|---|---|',
    line('resultado', (s) => s.outcome), line('passos', (s) => s.steps), line('tempo total (s)', (s) => s.elapsedS), line('s·GPU (gen_ms acumulado)', (s) => s.genS),
    line('tokens in / out', (s) => `${s.inTok} / ${s.outTok}`), line('cache read', (s) => s.cacheRead), line('tool calls inválidas', (s) => s.invalidCalls),
    line('degradou (passo)', (s) => (s.degraded ? `sim (${s.escalatedAtStep})` : 'não')), line('encerrou cedo (passos sobrando)', (s) => s.earlyStopRemaining),
    line('custo', (s) => (s.costUsd > 0 ? `US$ ${s.costUsd.toFixed(4)}` : `${s.genS} s·GPU`)), line('pico de VRAM (MiB)', (s) => s.vramPeakMiB ?? '—'),
    line('bloqueio de plataforma', (s) => s.platformBlock ?? 'nenhum')].join('\n');
}
```

`daemon/src/bench/vram.ts`:

```ts
/** Amostra `nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits`; `exec` é injetável para teste. */
export function startVramSampler(exec: () => Promise<string>, everyMs = 2000): { stop(): number } {
  let peak = 0; let active = true;
  const tick = async () => { if (!active) return; const v = Number((await exec().catch(() => '0')).trim()); if (v > peak) peak = v; if (active) setTimeout(tick, everyMs); };
  void tick();
  return { stop: () => { active = false; return peak; } };
}
```

`daemon/src/cli/bench.ts`:

```ts
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { CONFIG, loadEnv } from '../config.js';
import { createAdb } from '../device/adb.js';
import { openDb } from '../db/open.js';
import { getIdentity } from '../db/identities.js';
import { ensureIdentityReady } from '../fleet/identity.js';
import { median, pickWinner, renderBakeoffTable, renderComparison, type BakeoffRow, type RunSummary } from '../bench/stats.js';
import { startVramSampler } from '../bench/vram.js';
import { LOCAL_ENDPOINT_DEFAULT, readProviderConfig, updateProvider } from '../provider/config.js';
import { createOllamaSupervisor } from '../provider/ollama.js';
import { testProvider } from '../provider/probe.js';
import { runTask, type RunTaskResult } from '../worker/run.js';

const GOAL = 'Levantar comentários recentes sem resposta e propor rascunhos (não enviar)';
const MODELS = (process.env.BENCH_MODELS ?? 'qwen3.5:27b,gpt-oss:20b,gemma4:12b,qwen2.5-coder:14b').split(',').map((s) => s.trim()).filter(Boolean);
const RUNS = 3;
const exec = promisify(execFile);
const nvidia = async () => (await exec('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'])).stdout;

const env = loadEnv(); mkdirSync(CONFIG.dataDir, { recursive: true });
const db = openDb(CONFIG.dbPath); const adb = createAdb(); const ollama = createOllamaSupervisor();
const id = () => getIdentity(db, 'conta1')!;
const probe = await ensureIdentityReady(db, id(), { adb });
if (!probe.ready) { console.error('sonda falhou:', probe.details); process.exit(2); }

// 1) bake-off
const rows: BakeoffRow[] = [];
for (const model of MODELS) {
  updateProvider(db, 'worker', { mode: 'local', model, endpoint: LOCAL_ENDPOINT_DEFAULT });
  const tests = [];
  for (let i = 0; i < RUNS; i++) tests.push(await testProvider(db, readProviderConfig(db).worker, id(), env, { ollama }));
  const external = tests.some((t) => t.warning);
  if (external) { console.error('Ollama externo detectado; o benchmark exige o processo subido pelo daemon (spec §12).'); process.exit(3); }
  const valid = tests.filter((t) => t.argsValid).length; const err = tests.find((t) => t.error)?.error ?? null;
  rows.push({ model, latencyMs: median(tests.map((t) => t.latencyMs)), tokensPerSec: median(tests.map((t) => t.tokensPerSec ?? NaN)) || null, argsValid: valid, runs: RUNS, eliminated: valid < RUNS, reason: err ?? (valid < RUNS ? 'args inválidos' : null) });
  await ollama.unload(LOCAL_ENDPOINT_DEFAULT, model);
  console.log(`bake-off ${model}: ${valid}/${RUNS} válidos`);
}
const winner = pickWinner(rows);

// 2) corrida local com o vencedor + 3) controle Haiku
const summarize = async (label: string, r: RunTaskResult, elapsedS: number, vram: number | null): Promise<RunSummary> => {
  const s = db.prepare('select count(*) n, coalesce(sum(gen_ms),0) g from step where task_id=?').get(r.taskId) as { n: number; g: number };
  return { label, outcome: r.outcome, steps: s.n, elapsedS, genS: Math.round(s.g / 100) / 10, inTok: r.usage.inputTokens, outTok: r.usage.outputTokens, cacheRead: r.usage.cacheReadTokens,
    invalidCalls: r.invalidCalls, degraded: r.degraded, escalatedAtStep: r.escalatedAtStep, earlyStopRemaining: r.outcome === 'done' ? Math.max(0, CONFIG.worker.stepBudget - s.n) : 0,
    costUsd: r.costUsd, vramPeakMiB: vram, platformBlock: r.platformBlock, summary: r.summary };
};
const run = async (label: string, local: boolean) => {
  await ensureIdentityReady(db, id(), { adb });
  const sampler = local ? startVramSampler(nvidia) : null; const t0 = Date.now();
  const r = await runTask({ db, identity: id(), goalText: GOAL, apiKey: env.anthropicApiKey, isKilled: () => false, onStep: () => {}, stepBudget: CONFIG.worker.stepBudget }, { ollama });
  return summarize(label, r, Math.round((Date.now() - t0) / 1000), sampler?.stop() ?? null);
};
const local = winner ? await run(`local:${winner.model}`, true) : null;
if (winner) { updateProvider(db, 'worker', { mode: 'local', model: winner.model }); }
updateProvider(db, 'worker', { mode: 'nuvem', model: 'claude-haiku-4-5' });
const cloud = process.env.BENCH_SKIP_CLOUD ? null : await run('nuvem:claude-haiku-4-5', false);

// 4) relatório
const date = new Date().toISOString().slice(0, 10);
const out = `docs/superpowers/reports/${date}-incremento-2.md`;
const lines = [`# Incremento 2 — bake-off e benchmark (${new Date().toISOString()})`, '', `- Sonda: ${JSON.stringify(probe.signals)}`, `- Modelos: ${MODELS.join(', ')} · ${RUNS} testes cada`, '', '## Bake-off', '', renderBakeoffTable(rows), '',
  `**Vencedor:** ${winner?.model ?? 'nenhum (todos eliminados)'}`, '', '## Corrida completa (orçamento 30)', '',
  local && cloud ? renderComparison(local, cloud) : local ? renderComparison(local, local) : '_sem corrida local_', '',
  '## Resumo do agente — local', '', local?.summary ?? '—', '', '## Resumo do agente — Haiku', '', cloud?.summary ?? '(controle não repetido: BENCH_SKIP_CLOUD)'];
mkdirSync('docs/superpowers/reports', { recursive: true }); writeFileSync(out, lines.join('\n'));
console.log(`relatório em ${out}`); ollama.stop();
```

`package.json`: `"bench": "npm run daemon:build && node --env-file=.env dist-daemon/cli/bench.js"`.

Nota: ao final o registro do `worker` fica em `nuvem` (default de fábrica); a Task 10 decide se muda com base no relatório.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run --project daemon daemon/test/bench.test.ts && npx tsc -p tsconfig.daemon.json --noEmit`
Expected: PASS (4); tsc limpo

- [ ] **Step 5: Commit**

```bash
git add daemon/src/bench/stats.ts daemon/src/bench/vram.ts daemon/src/cli/bench.ts daemon/test/bench.test.ts package.json
git commit -m "feat(bench): bake-off entre modelos locais, corrida comparativa com o Haiku, pico de VRAM e relatório"
```

---

### Task 10: Execução real — bake-off, benchmark, relatório e decisão do default

**Files:**
- Create: `docs/superpowers/reports/<data>-incremento-2.md` (gerado)
- Modify (condicional): `daemon/src/provider/config.ts` (`PROVIDER_DEFAULTS.worker`), `daemon/test/provider-config.test.ts`
- Modify: `docs/superpowers/specs/2026-09-26-incremento-2-provedor-local-design.md` (§8 — resultado)

**Interfaces:** consome tudo; não produz código novo além do default.

Pré-condições (iguais ao `real:run`): emulador `mcp_test_playstore` vivo sob `ANDROID_ADB_SERVER_PORT=5038`, desbloqueado e com a tela acesa; `.env` com `ANTHROPIC_API_KEY`; nenhum `ollama serve` externo rodando (`curl -s 127.0.0.1:11434/api/tags` deve falhar — se responder, é externo e o benchmark recusa).

- [ ] **Step 1: Pré-voo**

Run:
```bash
ANDROID_ADB_SERVER_PORT=5038 /home/loterio/Android/Sdk/platform-tools/adb devices
curl -s -m 2 http://127.0.0.1:11434/api/tags || echo "ollama parado (esperado)"
nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader
```
Expected: `emulator-5554 device`; "ollama parado (esperado)"; VRAM usada < 5000 MiB.

- [ ] **Step 2: Rodar o benchmark**

Run: `npm run bench 2>&1 | tee .verify/bench.log`
Expected: quatro linhas `bake-off <modelo>: n/3 válidos`; `relatório em docs/superpowers/reports/<data>-incremento-2.md`. Duração esperada: 10–25 min (carregar 4 modelos + 2 corridas). Se um modelo derrubar o Ollama por OOM, a linha sai como `eliminado: infra-local: …` e o bake-off continua.

- [ ] **Step 3: Ler o relatório e checar o critério**

Run: `cat docs/superpowers/reports/*-incremento-2.md`
Expected: tabela do bake-off com 4 linhas; comparação local × Haiku; `bloqueio de plataforma: nenhum` nas duas. Critério de sucesso (spec §8): `tool calls inválidas = 0`, `degradou = não`, `tempo total local ≤ 3 × tempo Haiku`.

- [ ] **Step 4: Decidir o default (ruling ledgerado)**

Se o critério passou: em `PROVIDER_DEFAULTS.worker` trocar para `{ mode: 'local', model: '<vencedor>', endpoint: LOCAL_ENDPOINT_DEFAULT }` e atualizar o teste `provider-config` (`expect(a.worker).toMatchObject({ mode: 'local', model: '<vencedor>' })`) — RED→GREEN. Se não passou: manter `nuvem` e registrar no ledger `Task 10: Ruling: default do worker permanece nuvem — <números>`.

Em qualquer caso, acrescentar ao spec §8 um parágrafo **Resultado (data)** com vencedor, números e a decisão.

- [ ] **Step 5: Suíte e commit**

Run: `npx vitest run && npx tsc -p tsconfig.daemon.json --noEmit`
Expected: verde

```bash
git add docs/superpowers/reports/*-incremento-2.md docs/superpowers/specs/2026-09-26-incremento-2-provedor-local-design.md daemon/src/provider/config.ts daemon/test/provider-config.test.ts
git commit -m "docs(report): bake-off e benchmark local × Haiku do incremento 2; default do worker decidido"
```

---

## Self-review

- **Cobertura do spec:** §4.1–4.6 → T1–T4, T6, T8; §5 → T5; §6 → T6; §7 → T5 (`infra-local`, `quality-floor`) e T6/T4 (classificação); §8 → T9/T10; §9 → T1; §10 tabela de testes → cada linha tem tarefa; §11 respeitado (sem líder, sem pull, sem `think`).
- **Placeholders:** nenhum "TBD/TODO"; o único trecho "igual ao atual" (ledgerTool em T5) refere-se a código que a própria tarefa mantém no mesmo arquivo, não a outra tarefa.
- **Consistência de tipos:** `ProviderRow`/`RoleKey` só em `provider/config.ts`; renderer usa `LiveRoleKey` próprio (não importa do daemon); `ProviderTest` (T6) é o que T7 devolve e T8 consome como `LiveProviderTest` com os mesmos campos; `finishStep` (T5) é chamado por `recordStep` com os nomes novos; `RunTaskResult` (T5) é lido por `bench.ts` (T9) pelos campos `degraded`, `escalatedAtStep`, `invalidCalls`, `genMs`, `provider`.
- **Review Focus:** 1 → T6 (warning) + T9 (recusa); 2 → T1; 3 → T5; 4 → T7; 5 → T4. Todos com teste nomeado.
