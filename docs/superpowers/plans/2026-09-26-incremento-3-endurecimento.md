# Incremento 3 — Endurecimento Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar os 13 minors deferidos da revisão do incremento 2: piso que enxerga erro de parâmetro do MCP, parada precoce como dado, probe com três desfechos, validações e housekeeping do daemon, API de modelos, tela Provedores editável com erro visível, integração com Ollama real e guardas contra daemon vivo.

**Architecture:** Nenhum módulo novo grande: cada frente altera o arquivo que já é dono do comportamento (`provider/quality.ts`, `provider/probe.ts`, `provider/config.ts`, `provider/ollama.ts`, `server/api.ts`, `worker/run.ts`) e ganha teste no arquivo de teste correspondente. Novos: `fleet/lock.ts` (guarda de daemon vivo), `electron/provider-route.ts` (validação pura do IPC), `src/state/fleetReducer.test.ts`, `daemon/test/integration/ollama.integration.test.ts`.

**Tech Stack:** Node ≥ 24, TypeScript strict, `ai@7.0.116`, `@ai-sdk/openai-compatible@3`, zod 4, vitest, Electron 33 + React 18, Ollama 0.30.7.

**Spec:** `docs/superpowers/specs/2026-09-26-incremento-3-endurecimento-design.md` (estende os specs do incremento 2 e o principal)

## Global Constraints

- Node `>=24`; `tsc -p tsconfig.daemon.json`, `tsc -b`, `tsc -p tsconfig.electron.json` limpos em todo commit; suíte verde em todo commit.
- Imutabilidade; arquivos ≤ 800 linhas; funções pequenas.
- Testes unitários nunca tocam rede, `/proc` real, nem spawnam processo (guarda `VITEST` do incremento 2 permanece); só o arquivo de integração, sob `ENXAME_INTEGRATION=1`, usa a máquina.
- Piso: limite 3, acumulado; passa a contar `tool-error` cujo texto casa `/(?:^|: )(?:Parameter '[^']+' must|Missing required parameter)/`; erros de nó, gate e infra continuam fora.
- `GET /providers/models` é leitura pura: não chama `ensure`, não grava, não toca `inFlight`.
- Endpoint aceito só com `http:`/`https:`; o daemon só spawna Ollama quando o host é loopback (`127.0.0.1`, `localhost`, `::1`).
- `CLOUD_MODELS = ['claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5']`.
- Nunca imprimir `ANTHROPIC_API_KEY`; `.env` fora do git.
- Não alterar a tarefa de benchmark, o gate somente-leitura nem o servidor MCP.

## Review Focus

1. **Ollama parado ao abrir a tela Provedores** → `GET /providers/models` devolve `models: []` + `error`, e o card mantém o modelo atual como "(atual)" sem quebrar. Testes em Task 5 (rota) e Task 6 (`selectRoles`).
2. **Endpoint remoto vivo em modo local** (`http://192.168.1.5:11434/v1`) → conecta, não spawna, não adota, probe avisa contexto desconhecido. Teste em Task 4.
3. **Texto do erro de parâmetro com dois prefixos** — `Error executing tool X: Parameter…` (wrapper) e `Error: Error executing tool X: …` (errText) — ambos contam; `Node 'x' not found` não. Teste em Task 1.
4. **`PUT` rejeitado (409) durante tarefa** → a linha de erro aparece no card e some no próximo `PUT` bem-sucedido. Teste em Task 6 (reducer).
5. **Piso dispara no último passo do orçamento** → sem segmento 2, outcome `budget`, `degraded = 0`. Teste em Task 2.

---

### Task 1: Piso conta erro de parâmetro do servidor MCP

**Files:**
- Modify: `daemon/src/provider/quality.ts`
- Test: `daemon/test/quality.test.ts`, `daemon/test/record.test.ts`

**Interfaces:**
- Consumes: `StepLike` de `worker/record.ts`.
- Produces: `PARAM_ERROR_RE: RegExp`; `isParamError(text: string): boolean`; `invalidCallIds(step)` passa a incluir `toolCallId` de `tool-error` com texto de parâmetro (mesma assinatura). `recordStep` e `QualityFloor.observe` já consomem `invalidCallIds` — herdam o comportamento sem mudança.

- [ ] **Step 1: Testes (falham)**

Acrescentar em `daemon/test/quality.test.ts`:

```ts
import { isParamError } from '../src/provider/quality.js';

describe('erro de parâmetro do MCP (incremento 3, spec §4.1)', () => {
  const paramErr = (id: string, msg: string) => ({ type: 'tool-error', toolCallId: id, toolName: 'android_conta1_scroll', error: new Error(msg) });
  it('isParamError casa os formatos do servidor e os dois prefixos (Review Focus 3)', () => {
    for (const m of [
      "Error executing tool android_conta1_scroll: Parameter 'amount' must be one of: small, medium, large. Got: '500'",
      "Error: Error executing tool android_conta1_scroll: Parameter 'amount' must be one of: small, medium, large",
      "Parameter 'x' must be a number, got: 'abc'", "Parameter 'x' must be an integer, got: '1.5'", "Parameter 'text' must be non-empty",
      "Missing required parameter 'node_id'", "Error executing tool t: Missing required parameter: 'name'",
    ]) expect(isParamError(m), m).toBe(true);
    for (const m of [
      "Error executing tool android_conta1_scroll_to_node: Node 'node_43bc623c' not visible after 5 scroll attempts",
      "Node 'n1' not found", "Node 'n1' is not clickable", 'fetch failed: ECONNREFUSED', "device 'emulator-5554' not found",
    ]) expect(isParamError(m), m).toBe(false);
  });
  it('invalidCallIds inclui tool-error de parâmetro e o piso conta', () => {
    const s = step([paramErr('p1', "Error executing tool android_conta1_scroll: Parameter 'amount' must be one of: small, medium, large. Got: '500'"), paramErr('n1', "Node 'x' not found"), bad('b1')]);
    expect(invalidCallIds(s)).toEqual(['b1', 'p1']);
    const f = createQualityFloor(2); f.observe(s); expect(f.tripped()).toBe(true);
  });
  it('tool-error com string (não Error) também conta', () => {
    expect(invalidCallIds(step([{ type: 'tool-error', toolCallId: 's1', toolName: 't', error: "Parameter 'amount' must be one of: a, b" }]))).toEqual(['s1']);
  });
});
```

Acrescentar em `daemon/test/record.test.ts` (dentro do `describe('recordStep — proveniência (incremento 2)')` ou num novo):

```ts
  it('marca invalid_call=1 na linha de tool-error de parâmetro (incremento 3)', () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const { taskId } = createGoalAndTask(db, 'conta1', 'objetivo');
    const pending = new Map<string, number>();
    pending.set('c1', writeIntent(db, taskId, 'android_conta1_scroll', { amount: '500' }, `${taskId}:c1`));
    recordStep(db, taskId, { stepNumber: 1, text: '', usage: { inputTokens: 1, outputTokens: 1 }, content: [
      { type: 'tool-call', toolCallId: 'c1', toolName: 'android_conta1_scroll', input: { amount: '500' } },
      { type: 'tool-error', toolCallId: 'c1', toolName: 'android_conta1_scroll', error: new Error("Error executing tool android_conta1_scroll: Parameter 'amount' must be one of: small, medium, large. Got: '500'") },
    ] } as never, PRICING, pending, { provider: 'local:gpt-oss:20b', genMs: 1 });
    const s = db.prepare('select invalid_call, error from step where task_id=?').get(taskId) as { invalid_call: number; error: string };
    expect(s.invalid_call).toBe(1); expect(s.error).toMatch(/Parameter 'amount'/);
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --project daemon daemon/test/quality.test.ts daemon/test/record.test.ts`
Expected: FAIL — `isParamError` não exportado; `invalidCallIds` devolve `['b1']`; `invalid_call` 0.

- [ ] **Step 3: Implementar**

`daemon/src/provider/quality.ts` — substituir `invalidCallIds` e acrescentar:

```ts
/** Spec inc. 3 §4.1: mensagens de validação do servidor MCP (`Parameter '<x>' must …`, `Missing required parameter …`), com ou sem os prefixos do wrapper/errText. */
export const PARAM_ERROR_RE = /(?:^|: )(?:Parameter '[^']+' must|Missing required parameter)/;
export const isParamError = (text: string): boolean => PARAM_ERROR_RE.test(text);

interface MaybeToolError { readonly type: string; readonly toolCallId?: string; readonly error?: unknown }
const errorText = (e: unknown): string => (e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e) ?? '');

export function invalidCallIds(step: StepLike): readonly string[] {
  const schemaInvalid = step.content
    .filter((p): p is MaybeInvalidCall & { toolCallId: string } => p.type === 'tool-call' && (p as MaybeInvalidCall).invalid === true && typeof (p as MaybeInvalidCall).toolCallId === 'string')
    .map((p) => p.toolCallId);
  const paramErrors = step.content
    .filter((p): p is MaybeToolError & { toolCallId: string } => p.type === 'tool-error' && typeof (p as MaybeToolError).toolCallId === 'string' && isParamError(errorText((p as MaybeToolError).error)))
    .map((p) => p.toolCallId);
  return [...new Set([...schemaInvalid, ...paramErrors])];
}
```

Atualizar o comentário de `createQualityFloor`: "tool calls inválidas no schema e erros de parâmetro do servidor contam; negação do gate, erros de nó e de infra não".

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run --project daemon daemon/test/quality.test.ts daemon/test/record.test.ts && npx vitest run`
Expected: PASS (4 novos); suíte inteira verde (o teste do incremento 2 "não conta erro de infra" continua verde porque `device 'x' not found` não casa).

- [ ] **Step 5: Commit**

```bash
git add daemon/src/provider/quality.ts daemon/test/quality.test.ts daemon/test/record.test.ts
git commit -m "feat(quality): piso conta erro de parâmetro do servidor MCP (não erros de nó)"
```

---

### Task 2: Parada precoce como dado; orçamento exato do esc; `auth` deixa a identidade `idle`

**Files:**
- Modify: `daemon/src/db/migrate.ts` (coluna `task.early_stop_remaining`), `daemon/src/db/tasks.ts` (`setEarlyStop`), `daemon/src/worker/run.ts`, `daemon/src/server/snapshot.ts`, `daemon/src/cli/bench.ts`
- Test: `daemon/test/real-sdk.test.ts`, `daemon/test/server.test.ts`

**Interfaces:**
- Produces: `setEarlyStop(db, taskId, remaining: number): void`; `RunTaskResult.earlyStopRemaining: number`; `IdentitySnapshot.earlyStopRemaining: number`; `FleetSnapshot` idem via identidade.
- `bench.ts` passa a usar `r.earlyStopRemaining` em vez de calcular.

- [ ] **Step 1: Testes (falham)**

Acrescentar ao final de `daemon/test/real-sdk.test.ts`:

```ts
describe('runTask — incremento 3', () => {
  it('parada precoce: done com orçamento sobrando grava early_stop_remaining e sai no resultado', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const m = new MockLanguageModelV4({ doGenerate: [text('nada a fazer')] as never });
    const r = await runTask({ ...opts(db), providers: providers(), stepBudget: 10 }, { connect: mkMcp(tools()), model: m, ollama: okOllama });
    expect(r.outcome).toBe('done'); expect(r.earlyStopRemaining).toBe(9);
    expect((db.prepare('select early_stop_remaining as e from task where id=?').get(r.taskId) as { e: number }).e).toBe(9);
  });
  it('piso no último passo do orçamento → sem segmento 2, outcome budget, degraded 0 (Review Focus 5)', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const worker = new MockLanguageModelV4({ doGenerate: [invalid('c1'), invalid('c2'), invalid('c3')] as never });
    const esc = new MockLanguageModelV4({ doGenerate: [text('não')] as never });
    const r = await runTask({ ...opts(db), providers: providers(), stepBudget: 3 }, { connect: mkMcp(tools()), model: worker, escModel: esc, ollama: okOllama });
    expect(r.outcome).toBe('budget'); expect(r.degraded).toBe(false); expect(esc.doGenerateCalls).toHaveLength(0); expect(r.earlyStopRemaining).toBe(0);
  });
  it('ProviderError auth (sem chave, worker na nuvem) → failed, identidade idle, lastError cita a chave', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const r = await runTask({ ...opts(db), apiKey: '' }, { connect: mkMcp(tools()) });
    expect(r.outcome).toBe('failed'); expect(taskState(db, r.taskId)).toBe('failed');
    expect(getIdentity(db, 'conta1')?.state).toBe('idle'); expect(getIdentity(db, 'conta1')?.lastError).toMatch(/ANTHROPIC_API_KEY/);
  });
});
```

Acrescentar em `daemon/test/server.test.ts` (novo `describe`):

```ts
describe('snapshot — incremento 3', () => {
  it('identidade traz earlyStopRemaining da última tarefa', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const { createGoalAndTask, setEarlyStop } = await import('../src/db/tasks.js');
    const { taskId } = createGoalAndTask(db, 'conta1', 'g'); setEarlyStop(db, taskId, 13);
    const s = await startServer({ db, port: 0, token: 'seg', onGoal: async () => {}, onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); } }); stop = s.close;
    const snap = await (await fetch(`http://127.0.0.1:${s.port}/state`, { headers: { authorization: 'Bearer seg' } })).json() as { identities: { earlyStopRemaining: number }[] };
    expect(snap.identities[0].earlyStopRemaining).toBe(13);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --project daemon daemon/test/real-sdk.test.ts daemon/test/server.test.ts`
Expected: FAIL — `earlyStopRemaining` undefined; `setEarlyStop` não existe; teste do piso no último passo devolve `done`/`degraded true`; teste auth: identidade `offline`.

- [ ] **Step 3: Implementar**

`daemon/src/db/migrate.ts` — acrescentar à lista `COLUMNS`:

```ts
  { table: 'task', column: 'early_stop_remaining', ddl: 'integer' },
```

`daemon/src/db/tasks.ts` — acrescentar:

```ts
export function setEarlyStop(db: DatabaseSync, taskId: string, remaining: number): void {
  db.prepare('update task set early_stop_remaining=? where id=?').run(remaining, taskId);
}
```

`daemon/src/worker/run.ts`:
- importar `setEarlyStop` de `../db/tasks.js`;
- `RunTaskResult` ganha `readonly earlyStopRemaining: number;`
- em `finish`, antes do `return`:

```ts
    const earlyStopRemaining = outcome === 'done' ? Math.max(0, budget - stepsUsed) : 0;
    setEarlyStop(db, taskId, earlyStopRemaining);
```
  e incluir `earlyStopRemaining` no objeto devolvido;
- `idState`: `h?.kind === 'platform-block' ? 'needs-human' : h && h.kind !== 'infra-local' ? 'offline' : 'idle'` **fica**; o que muda é o `catch`: `ProviderError('auth')` não vira `halt`:

```ts
    if (ProviderError.isInstance(e)) {
      // Chave ausente é falha da tarefa, não do device: identidade volta a idle (spec inc. 3 §4.4).
      if (e.kind === 'auth') return finish('failed', e.message);
      halt = { kind: e.kind, text: e.message }; return finish('infra', e.message);
    }
```
- escalonamento só com orçamento restante:

```ts
    const remaining = budget - stepsUsed;
    if (floor.tripped() && !halt && !o.isKilled() && remaining > 0) {
      …
      result = await segment(cfg.esc, escModel, tools, continued, stopIfHalted, slug, remaining);
    }
```
  (remover o `Math.max(1, …)`).

`daemon/src/server/snapshot.ts`: `IdentitySnapshot` ganha `readonly earlyStopRemaining: number`; a consulta da tarefa inclui `early_stop_remaining`; no objeto: `earlyStopRemaining: task?.early_stop_remaining ?? 0`.

`daemon/src/cli/bench.ts`: em `summarize`, `earlyStopRemaining: r.earlyStopRemaining`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run && npx tsc -p tsconfig.daemon.json --noEmit`
Expected: PASS (4 novos); tsc limpo. O teste do incremento 2 "piso em 3 inválidas → segundo generateText" continua verde (orçamento 10, sobra 6).

- [ ] **Step 5: Commit**

```bash
git add daemon/src/db/migrate.ts daemon/src/db/tasks.ts daemon/src/worker/run.ts daemon/src/server/snapshot.ts daemon/src/cli/bench.ts daemon/test/real-sdk.test.ts daemon/test/server.test.ts
git commit -m "feat(worker): parada precoce gravada e no snapshot; esc só com orçamento restante; auth deixa identidade idle"
```

---

### Task 3: Probe com três desfechos e `at` consistente

**Files:**
- Modify: `daemon/src/provider/probe.ts`
- Test: `daemon/test/provider-probe.test.ts`

**Interfaces:**
- `ProviderTest` inalterado; semântica: schema inválido → `argsValid:false, error:null`; `isError` do MCP → `error:'MCP: …'`; tool lançou → `error:'infra: …'`; `at` gravado = `at` devolvido.
- `recordProviderTest` passa a inserir a coluna `at` explicitamente.

- [ ] **Step 1: Testes (falham)**

Acrescentar em `daemon/test/provider-probe.test.ts`:

```ts
describe('probe — três desfechos (incremento 3, spec §4.3)', () => {
  const mcpErr = { isError: true, content: [{ type: 'text', text: 'Error executing tool: accessibility service disabled' }] };
  const connectWith = (exec: () => Promise<unknown>) => async () => ({ tools: async () => ({
    android_conta1_get_screen_state: tool({ description: 't', inputSchema: z.object({ include_screenshot: z.boolean().optional() }), execute: exec }),
  }), close: async () => {} });
  it('tool executou mas o MCP devolveu isError → argsValid false e error "MCP: …"', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const t = await testProvider(db, LOCAL, row, {}, { connect: connectWith(async () => mcpErr), model: new MockLanguageModelV4({ doGenerate: [screenCall('{}')] as never }), ollama: external() });
    expect(t.argsValid).toBe(false); expect(t.error).toMatch(/^MCP: .*accessibility/);
  });
  it('tool lançou → argsValid false e error "infra: …" (não "argumentos inválidos")', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const t = await testProvider(db, LOCAL, row, {}, { connect: connectWith(async () => { throw new Error("device 'emulator-5554' not found"); }), model: new MockLanguageModelV4({ doGenerate: [screenCall('{}')] as never }), ollama: external() });
    expect(t.argsValid).toBe(false); expect(t.error).toMatch(/^infra: .*not found/);
  });
  it('at gravado é o mesmo ISO devolvido', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const t = await testProvider(db, LOCAL, row, {}, { connect, model: new MockLanguageModelV4({ doGenerate: [screenCall('{}')] as never }), ollama: external() });
    expect(lastProviderTests(db).worker?.at).toBe(t.at); expect(t.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --project daemon daemon/test/provider-probe.test.ts`
Expected: FAIL — isError vem como `argsValid:true`; tool que lança dá `error:null`; `at` gravado no formato do SQLite.

- [ ] **Step 3: Implementar**

`daemon/src/provider/probe.ts`:
- importar `textOf` de `../worker/record.js`;
- `recordProviderTest`: `insert into provider_test (role, model, at, latency_ms, tokens_per_sec, args_valid, warning, error) values (?, ?, ?, ?, ?, ?, ?, ?)` com `t.at` na terceira posição;
- substituir o trecho após `const step = r.steps[0];` por:

```ts
    type Part = { type: string; invalid?: boolean; output?: unknown; error?: unknown };
    const parts = (step?.content ?? []) as readonly Part[];
    const call = parts.find((p) => p.type === 'tool-call');
    const result = parts.find((p) => p.type === 'tool-result');
    const failure = parts.find((p) => p.type === 'tool-error');
    const out = r.usage.outputTokens ?? 0;
    const tps = genMs > 0 ? Math.round((out / (genMs / 1000)) * 10) / 10 : null;
    const measured = { ...base, latencyMs: Date.now() - t0, tokensPerSec: tps, warning };
    if (!call || call.invalid) return recordProviderTest(db, measured);                       // argumentos inválidos
    if (failure) return recordProviderTest(db, { ...measured, error: `infra: ${errorText(failure.error)}`.slice(0, 300) });
    const isErr = !!result && typeof result.output === 'object' && result.output !== null && (result.output as { isError?: boolean }).isError === true;
    if (isErr) return recordProviderTest(db, { ...measured, error: `MCP: ${textOf(result!.output)}`.slice(0, 300) });
    return recordProviderTest(db, { ...measured, argsValid: !!result });
```
  com `const errorText = (e: unknown): string => (e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e) ?? '');` no topo do arquivo.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run --project daemon daemon/test/provider-probe.test.ts && npx tsc -p tsconfig.daemon.json --noEmit`
Expected: PASS (3 novos + os 6 anteriores); tsc limpo

- [ ] **Step 5: Commit**

```bash
git add daemon/src/provider/probe.ts daemon/test/provider-probe.test.ts
git commit -m "fix(probe): distingue args inválidos, isError do MCP e tool que lança; at consistente"
```

---

### Task 4: Endurecimentos do daemon (endpoint http(s), loopback, log, seed, API)

**Files:**
- Modify: `daemon/src/provider/config.ts`, `daemon/src/provider/ollama.ts`, `daemon/src/db/open.ts`, `daemon/src/server/api.ts`
- Test: `daemon/test/provider-config.test.ts`, `daemon/test/ollama.test.ts`, `daemon/test/server.test.ts`

**Interfaces:**
- Produces: `CLOUD_MODELS: readonly string[]`; `seedProviderConfig(db): void` (em `config.ts`, chamado por `openDb`); `readProviderConfig` só lê (devolve defaults para papel ausente **sem inserir**); `patchErrorMessage(err: ZodError): string`; `isLoopbackHost(host: string): boolean` (em `ollama.ts`); `OllamaDeps.closeLog?: (fd: unknown) => void`.

- [ ] **Step 1: Testes (falham)**

`daemon/test/provider-config.test.ts` — acrescentar:

```ts
import { DatabaseSync } from 'node:sqlite';
import { applyMigrations } from '../src/db/migrate.js';
import { SCHEMA } from '../src/db/schema.js';
import { CLOUD_MODELS, patchErrorMessage, ProviderPatch, seedProviderConfig } from '../src/provider/config.js';

describe('config — incremento 3', () => {
  it('endpoint só http(s); mensagem única legível', () => {
    for (const e of ['ftp://x/v1', 'file:///etc/passwd', 'javascript:alert(1)']) {
      const r = ProviderPatch.safeParse({ endpoint: e }); expect(r.success, e).toBe(false);
      if (!r.success) expect(patchErrorMessage(r.error)).toBe('endpoint precisa ser http(s)');
    }
    expect(ProviderPatch.safeParse({ endpoint: 'http://192.168.1.5:11434/v1' }).success).toBe(true);
    expect(CLOUD_MODELS).toEqual(['claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5']);
  });
  it('readProviderConfig não insere; seedProviderConfig insere uma vez; openDb semeia', () => {
    const raw = new DatabaseSync(':memory:'); raw.exec(SCHEMA); applyMigrations(raw);
    expect(readProviderConfig(raw).worker.model).toBe('gpt-oss:20b');
    expect((raw.prepare('select count(*) as n from provider_config').get() as { n: number }).n).toBe(0);
    seedProviderConfig(raw); seedProviderConfig(raw);
    expect((raw.prepare('select count(*) as n from provider_config').get() as { n: number }).n).toBe(3);
    const db = openDb(':memory:');
    expect((db.prepare('select count(*) as n from provider_config').get() as { n: number }).n).toBe(3);
  });
});
```

`daemon/test/ollama.test.ts` — acrescentar:

```ts
import path from 'node:path';
import { CONFIG } from '../src/config.js';
import { isLoopbackHost } from '../src/provider/ollama.js';

describe('supervisor — incremento 3', () => {
  it('isLoopbackHost', () => {
    for (const h of ['127.0.0.1:11434', 'localhost:11434', '[::1]:11434', '127.0.0.1']) expect(isLoopbackHost(h), h).toBe(true);
    for (const h of ['192.168.1.5:11434', 'ollama.lan:11434', '10.0.0.2']) expect(isLoopbackHost(h), h).toBe(false);
  });
  it('endpoint remoto morto → infra-local sem spawn; remoto vivo → conecta sem adotar (Review Focus 2)', async () => {
    const spawned: string[] = [];
    const dead = createOllamaSupervisor({ fetch: (async () => { throw new Error('ECONNREFUSED'); }) as never, sleep: async () => {}, findProcesses: () => [], spawn: () => { spawned.push('x'); return { pid: 1, kill: () => true, on: () => undefined }; } });
    await expect(dead.ensure('http://192.168.1.5:11434/v1', 'm')).rejects.toMatchObject({ kind: 'infra-local', message: expect.stringMatching(/remoto/) });
    expect(spawned).toEqual([]);
    const alive = createOllamaSupervisor({ fetch: (async () => tags('m')) as never, findProcesses: () => [{ pid: 9, env: 'OLLAMA_HOST=127.0.0.1:11434\0OLLAMA_CONTEXT_LENGTH=32768\0' }] });
    expect(await alive.ensure('http://192.168.1.5:11434/v1', 'm')).toMatchObject({ spawnedByUs: false, adopted: false });
  });
  it('logPath fica em CONFIG.dataDir e o fd é fechado no stop()', async () => {
    const opened: string[] = []; const closed: unknown[] = [];
    const sup = createOllamaSupervisor({ fetch: (async () => { throw new Error('ECONNREFUSED'); }) as never, sleep: async () => {}, timeoutMs: 1, findProcesses: () => [],
      openLog: (p) => { opened.push(p); return 42; }, closeLog: (fd) => { closed.push(fd); }, spawn: () => ({ pid: 1, kill: () => true, on: () => undefined }) });
    await sup.ensure('http://127.0.0.1:11434/v1', 'm').catch(() => undefined);
    expect(opened[0]).toBe(path.join(CONFIG.dataDir, 'ollama.log')); expect(closed).toEqual([42]);
  });
});
```

`daemon/test/server.test.ts` — acrescentar:

```ts
describe('servidor — incremento 3', () => {
  const h = { authorization: 'Bearer seg', 'content-type': 'application/json' };
  it('PUT inválido devolve mensagem única; erro interno vira 500 JSON', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const s = await startServer({ db, port: 0, token: 'seg', onGoal: async () => {}, onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); } }); stop = s.close;
    const bad = await fetch(`http://127.0.0.1:${s.port}/providers/worker`, { method: 'PUT', headers: h, body: JSON.stringify({ endpoint: 'ftp://x' }) });
    expect(bad.status).toBe(400); expect(await bad.json()).toEqual({ error: 'endpoint precisa ser http(s)' });
    db.close();
    const boom = await fetch(`http://127.0.0.1:${s.port}/providers/worker`, { method: 'PUT', headers: h, body: JSON.stringify({ model: 'x' }) });
    expect(boom.status).toBe(500); expect(((await boom.json()) as { error: string }).error).toBeTruthy();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --project daemon daemon/test/provider-config.test.ts daemon/test/ollama.test.ts daemon/test/server.test.ts`
Expected: FAIL — exports ausentes; `readProviderConfig` insere (count 3); remoto morto spawna; `logPath` no home; 400 com array; 500 vira requisição pendurada/erro.

- [ ] **Step 3: Implementar**

`daemon/src/provider/config.ts`:

```ts
export const CLOUD_MODELS: readonly string[] = ['claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5'];

const HttpUrl = z.string().url().refine((u) => /^https?:\/\//i.test(u), { message: 'endpoint precisa ser http(s)' });
export const ProviderPatch = z.object({
  mode: z.enum(['nuvem', 'local']).optional(),
  model: z.string().min(1).max(120).optional(),
  endpoint: HttpUrl.optional(),
}).strict();

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
```

(O `updateProvider` continua chamando `readProviderConfig` e depois `update … where role=?`; como `openDb` semeou, a linha existe. Para bancos abertos sem `openDb` — só testes — `updateProvider` faz `insert or ignore` antes do `update`: acrescentar `seedProviderConfig(db)` como primeira linha de `updateProvider`; é idempotente e barato.)

`daemon/src/db/open.ts`: importar `seedProviderConfig` de `../provider/config.js` e chamar após `applyMigrations(db)`.

`daemon/src/provider/ollama.ts`:
- importar `closeSync, mkdirSync` de `node:fs`, `CONFIG` de `../config.js`;
- `export const isLoopbackHost = (host: string): boolean => /^(?:127\.0\.0\.1|localhost|\[::1\]|::1)(?::\d+)?$/i.test(host);`
- `OllamaDeps` ganha `readonly closeLog?: (fd: unknown) => void;`
- defaults: `const logPath = deps.logPath ?? path.join(CONFIG.dataDir, 'ollama.log');` `const openLog = deps.openLog ?? ((p: string) => { mkdirSync(path.dirname(p), { recursive: true }); return openSync(p, 'a'); });` `const closeLog = deps.closeLog ?? ((fd: unknown) => { try { closeSync(fd as number); } catch { /* já fechado */ } });`
- estado `let logFd: unknown = null;` e helper `const releaseLog = () => { if (logFd !== null) { closeLog(logFd); logFd = null; } };`
- em `ensure`, antes de spawnar: `if (!isLoopbackHost(host)) throw new ProviderError('infra-local', \`endpoint remoto ${host}: suba o Ollama lá; o daemon só sobe processo local\`);`
- `const log = openLog(logPath); logFd = log;` e chamar `releaseLog()` em: `on('exit')`, `on('error')`, no `stop()`, e no timeout antes de lançar.
- na adoção: só adotar quando `isLoopbackHost(host)` (um processo local nunca serve um endpoint remoto).

`daemon/src/server/api.ts`:
- importar `patchErrorMessage`;
- envolver o corpo do handler em `try { … } catch (e) { return send(res, 500, { error: String((e as Error).message ?? e) }); }`;
- na rota `PUT`: ler o corpo **antes** do check de `inFlight`:

```ts
      if (req.method === 'PUT' && !isTest) {
        const parsed = ProviderPatch.safeParse(await readJson(req));
        if (!parsed.success) return send(res, 400, { error: patchErrorMessage(parsed.error) });
        if (inFlight) return send(res, 409, { error: 'objetivo ou teste em execução; troca de provedor só com a frota parada' });
        const row = updateProvider(o.db, role, parsed.data); send(res, 200, row); ws.broadcast(); return;
      }
      if (req.method === 'POST' && isTest) {
        if (inFlight) return send(res, 409, { error: 'objetivo ou teste em execução' });
        …
      }
```
  (o check genérico de `inFlight` que hoje antecede os dois métodos sai.)

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run && npx tsc -p tsconfig.daemon.json --noEmit`
Expected: PASS (todos os novos); suíte verde. Atenção: o teste "PUT e test → 409 enquanto um objetivo roda" do incremento 2 envia body válido → continua 409.

- [ ] **Step 5: Commit**

```bash
git add daemon/src/provider/config.ts daemon/src/provider/ollama.ts daemon/src/db/open.ts daemon/src/server/api.ts daemon/test/provider-config.test.ts daemon/test/ollama.test.ts daemon/test/server.test.ts
git commit -m "fix(daemon): endpoint só http(s), spawn só em loopback, log em dataDir com fd fechado, seed em openDb, API com try/catch"
```

---

### Task 5: `GET /providers/models` e guarda de daemon vivo

**Files:**
- Modify: `daemon/src/server/api.ts`
- Create: `daemon/src/fleet/lock.ts`
- Modify: `daemon/src/cli/bench.ts`, `daemon/src/cli/run-real.ts`
- Test: `daemon/test/server.test.ts`, `daemon/test/lock.test.ts`

**Interfaces:**
- Produces: `GET /providers/models?role=<papel>` → `{ source: 'ollama' | 'anthropic'; models: string[]; error: string | null }` (404 papel desconhecido); `ServerOpts.fetch?: typeof fetch` (injetável); `daemonAlive(infoPath: string, isAlive?: (pid: number) => boolean): { pid: number } | null`.

- [ ] **Step 1: Testes (falham)**

`daemon/test/server.test.ts` — acrescentar ao `describe('servidor — incremento 3')`:

```ts
  it('GET /providers/models: local com Ollama parado → [] + error; local vivo → nomes; nuvem → CLOUD_MODELS (Review Focus 1)', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    let up = false;
    const fetchFn = (async () => { if (!up) throw new Error('ECONNREFUSED'); return new Response(JSON.stringify({ models: [{ name: 'gpt-oss:20b' }, { name: 'gemma4:12b' }] })); }) as unknown as typeof fetch;
    const s = await startServer({ db, port: 0, token: 'seg', fetch: fetchFn, onGoal: async () => {}, onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); } }); stop = s.close;
    const get = async (role: string) => (await fetch(`http://127.0.0.1:${s.port}/providers/models?role=${role}`, { headers: h })).json() as Promise<{ source: string; models: string[]; error: string | null }>;
    expect(await get('worker')).toEqual({ source: 'ollama', models: [], error: 'Ollama parado — o próximo teste ou objetivo o sobe' });
    up = true;
    expect(await get('worker')).toEqual({ source: 'ollama', models: ['gpt-oss:20b', 'gemma4:12b'], error: null });
    expect(await get('esc')).toEqual({ source: 'anthropic', models: ['claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5'], error: null });
    expect((await fetch(`http://127.0.0.1:${s.port}/providers/models?role=chefe`, { headers: h })).status).toBe(404);
  });
```

`daemon/test/lock.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { daemonAlive } from '../src/fleet/lock.js';

describe('daemonAlive', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'enxame-lock-'));
  it('arquivo ausente → null; PID morto → null; PID vivo → { pid }', () => {
    expect(daemonAlive(path.join(dir, 'nao-existe.json'))).toBeNull();
    const dead = path.join(dir, 'dead.json'); writeFileSync(dead, JSON.stringify({ port: 1, token: 't', pid: 999999 }));
    expect(daemonAlive(dead, () => false)).toBeNull();
    const live = path.join(dir, 'live.json'); writeFileSync(live, JSON.stringify({ port: 1, token: 't', pid: process.pid }));
    expect(daemonAlive(live)).toEqual({ pid: process.pid });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --project daemon daemon/test/server.test.ts daemon/test/lock.test.ts`
Expected: FAIL — `/providers/models` cai em 404 "papel desconhecido"; módulo `lock.js` ausente.

- [ ] **Step 3: Implementar**

`daemon/src/fleet/lock.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';

const pidAlive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** bench/run-real disputam device e Ollama com um daemon vivo; leem daemon.json e recusam (spec inc. 3 §4.6). */
export function daemonAlive(infoPath: string, isAlive: (pid: number) => boolean = pidAlive): { pid: number } | null {
  if (!existsSync(infoPath)) return null;
  try {
    const info = JSON.parse(readFileSync(infoPath, 'utf8')) as { pid?: number };
    return typeof info.pid === 'number' && isAlive(info.pid) ? { pid: info.pid } : null;
  } catch { return null; }
}
```

`daemon/src/server/api.ts`:
- `ServerOpts` ganha `readonly fetch?: typeof fetch;`; `const fetchFn = o.fetch ?? fetch;`
- importar `CLOUD_MODELS, ollamaBase`;
- **antes** de `PROVIDERS_ROUTE.exec`, a rota de modelos:

```ts
    if (req.method === 'GET' && url.pathname === '/providers/models') {
      const role = url.searchParams.get('role') ?? '';
      if (!isRole(role)) return send(res, 404, { error: 'papel desconhecido' });
      const cfg = readProviderConfig(o.db)[role];
      if (cfg.mode === 'nuvem') return send(res, 200, { source: 'anthropic', models: CLOUD_MODELS, error: null });
      // Leitura pura: nunca sobe o Ollama para listar (spec inc. 3 §4.5).
      try {
        const r = await fetchFn(`${ollamaBase(cfg.endpoint)}/api/tags`);
        const j = r.ok ? await r.json() as { models?: { name: string }[] } : { models: [] };
        return send(res, 200, { source: 'ollama', models: (j.models ?? []).map((m) => m.name), error: null });
      } catch { return send(res, 200, { source: 'ollama', models: [], error: 'Ollama parado — o próximo teste ou objetivo o sobe' }); }
    }
```

`daemon/src/cli/bench.ts` e `daemon/src/cli/run-real.ts` — logo após `const env = loadEnv();`:

```ts
import { daemonAlive } from '../fleet/lock.js';
const living = daemonAlive(CONFIG.daemonInfoPath);
if (living) { console.error(`daemon vivo (PID ${living.pid}) disputa device e Ollama; pare-o ou use a API`); process.exit(4); }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run && npx tsc -p tsconfig.daemon.json --noEmit`
Expected: PASS; tsc limpo

- [ ] **Step 5: Commit**

```bash
git add daemon/src/server/api.ts daemon/src/fleet/lock.ts daemon/src/cli/bench.ts daemon/src/cli/run-real.ts daemon/test/server.test.ts daemon/test/lock.test.ts
git commit -m "feat(daemon): GET /providers/models e guarda de daemon vivo no bench/run-real"
```

---

### Task 6: Tela Provedores editável, erro visível, métricas na identidade, IPC validado

**Files:**
- Create: `electron/provider-route.ts`, `electron/provider-route.test.ts`, `src/state/fleetReducer.test.ts`, `src/state/selectors.test.ts`
- Modify: `vitest.config.ts` (projeto `electron`), `electron/main.ts`, `electron/preload.ts`, `src/live/types.ts`, `src/live/merge.ts`, `src/live/merge.test.ts`, `src/types/fleet.ts`, `src/state/fleetReducer.ts`, `src/state/selectors.ts`, `src/state/useFleet.ts`, `src/screens/Providers.tsx`, `src/screens/Providers.css`, `src/App.tsx`

**Interfaces:**
- Produces: `providerRoute(role: string, kind: 'put' | 'test' | 'models'): string` (lança `Error('papel inválido')`); `EnxameBridge.getProviderModels(role)`; `FleetState.providerErrors`, `FleetState.providerModels`; ações `providerError { role, message: string | null }`, `providerModels { role, models }`; `FleetActions.setProviderField(role, patch)`, `FleetActions.loadProviderModels(role)`; `RoleVM.models: readonly string[]`, `RoleVM.error: string | null`; `Identity` ganha `genMs?: number; degraded?: boolean; earlyStopRemaining?: number`; `ProvidersProps` ganha `onSetField`, `onLoadModels`.

- [ ] **Step 1: Testes (falham)**

`electron/provider-route.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { providerRoute } from './provider-route';

describe('providerRoute', () => {
  it('monta os três caminhos para papéis válidos', () => {
    expect(providerRoute('worker', 'put')).toBe('/providers/worker');
    expect(providerRoute('esc', 'test')).toBe('/providers/esc/test');
    expect(providerRoute('lider', 'models')).toBe('/providers/models?role=lider');
  });
  it('rejeita papel fora da lista ou com caracteres de path/query', () => {
    for (const r of ['chefe', '../kill?x=', 'worker/test', 'worker?x=1', '']) expect(() => providerRoute(r, 'put'), r).toThrow(/papel inválido/);
  });
});
```

`vitest.config.ts` — acrescentar o projeto `{ test: { name: 'electron', environment: 'node', include: ['electron/**/*.test.ts'] } }`.

`src/state/fleetReducer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createInitialState, fleetReducer } from './fleetReducer';

describe('fleetReducer — provedores (incremento 3)', () => {
  it('providerError grava e limpa por papel (Review Focus 4)', () => {
    const s0 = createInitialState();
    const s1 = fleetReducer(s0, { type: 'providerError', role: 'worker', message: 'objetivo ou teste em execução' });
    expect(s1.providerErrors.worker).toBe('objetivo ou teste em execução'); expect(s1.providerErrors.esc).toBeUndefined();
    const s2 = fleetReducer(s1, { type: 'providerError', role: 'worker', message: null });
    expect(s2.providerErrors.worker).toBeUndefined(); expect(s0.providerErrors).toEqual({});
  });
  it('providerModels grava a lista por papel sem mutar o estado anterior', () => {
    const s0 = createInitialState();
    const s1 = fleetReducer(s0, { type: 'providerModels', role: 'worker', models: ['gpt-oss:20b', 'gemma4:12b'] });
    expect(s1.providerModels.worker).toEqual(['gpt-oss:20b', 'gemma4:12b']); expect(s0.providerModels).toEqual({});
  });
});
```

`src/state/selectors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createInitialState, fleetReducer } from './fleetReducer';
import { decorateTile, selectRoles, selectSelStats } from './selectors';

describe('selectors — incremento 3', () => {
  it('selectRoles expõe modelos carregados e erro; sem lista, oferece o modelo atual (Review Focus 1)', () => {
    const s = fleetReducer(fleetReducer(createInitialState(), { type: 'providerModels', role: 'worker', models: ['gpt-oss:20b'] }), { type: 'providerError', role: 'esc', message: 'endpoint precisa ser http(s)' });
    const roles = selectRoles(s);
    expect(roles.find((r) => r.key === 'worker')?.models).toEqual(['gpt-oss:20b']);
    expect(roles.find((r) => r.key === 'esc')?.error).toBe('endpoint precisa ser http(s)');
    const lider = roles.find((r) => r.key === 'lider')!; expect(lider.models).toEqual([lider.model]); expect(lider.error).toBeNull();
  });
  it('custo mostra s·GPU quando há genMs; passos mostram sobra; task marca degradada', () => {
    const base = createInitialState().ids[0];
    const t = decorateTile({ ...base, cost: 0.2, genMs: 33900, degraded: true, earlyStopRemaining: 13, steps: 17, budget: 30 }, 0, false);
    expect(t.costFmt).toMatch(/33,9 s GPU/);
    expect(selectSelStats(t)[0].value).toBe('17/30 · 13 sobrando');
    expect(decorateTile({ ...base, genMs: 0 }, 0, false).costFmt).not.toMatch(/GPU/);
  });
});
```

`src/live/merge.test.ts` — acrescentar:

```ts
describe('mergeLive — incremento 3', () => {
  it('aplica degraded, genMs e earlyStopRemaining na identidade viva e o sufixo na task', () => {
    const out = mergeLive(IDENTITIES, { ...live, identities: [{ ...live.identities[0], degraded: true, genMs: 33900, earlyStopRemaining: 13 }] });
    expect(out[0]).toMatchObject({ degraded: true, genMs: 33900, earlyStopRemaining: 13 });
    expect(out[0].task).toMatch(/· degradada$/);
  });
  it('liveLogFor mostra o provedor curto por linha', () => {
    const rows = liveLogFor({ ...live, identities: [{ ...live.identities[0], lastTools: [{ idx: 1, tool: 't', excerpt: 'x', tokens: 1000, gate: false, provider: 'local:gpt-oss:20b' }] }] }, 'conta1');
    expect(rows?.[0].desc).toMatch(/^\[local\] /);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --project renderer --project electron`
Expected: FAIL — módulos/ações/campos inexistentes (o projeto `electron` só existe após editar `vitest.config.ts`; sem ele o teste do IPC nem é coletado — editar o config **neste passo** e ver o teste falhar por módulo ausente).

- [ ] **Step 3: Implementar — Electron**

`electron/provider-route.ts`:

```ts
const ROLES = new Set(['lider', 'worker', 'esc']);

/** O renderer manda `role` livre pelo IPC; só os três papéis viram path (spec inc. 3 §4.5). */
export function providerRoute(role: string, kind: 'put' | 'test' | 'models'): string {
  if (!ROLES.has(role)) throw new Error(`papel inválido: ${JSON.stringify(role)}`);
  if (kind === 'models') return `/providers/models?role=${role}`;
  return kind === 'test' ? `/providers/${role}/test` : `/providers/${role}`;
}
```

`electron/daemon-bridge.ts` — `request` aceita `'GET'` também (`method: 'GET' | 'PUT' | 'POST'`).

`electron/main.ts` — substituir os dois handlers de provedor e acrescentar o de modelos:

```ts
import { providerRoute } from './provider-route.js';
    ipcMain.handle('enxame:setProvider', (_e, role: string, patch: unknown) => request(info, 'PUT', providerRoute(role, 'put'), patch));
    ipcMain.handle('enxame:testProvider', (_e, role: string) => request(info, 'POST', providerRoute(role, 'test')));
    ipcMain.handle('enxame:getProviderModels', (_e, role: string) => request(info, 'GET', providerRoute(role, 'models')));
```

`electron/preload.ts`: `getProviderModels: (role: string) => ipcRenderer.invoke('enxame:getProviderModels', role),`

- [ ] **Step 4: Implementar — renderer**

`src/live/types.ts`: `LiveIdentity` ganha `readonly earlyStopRemaining?: number;` `EnxameBridge` ganha `readonly getProviderModels: (role: LiveRoleKey) => Promise<{ source: string; models: readonly string[]; error: string | null }>;`

`src/types/fleet.ts` — `Identity` ganha `readonly genMs?: number; readonly degraded?: boolean; readonly earlyStopRemaining?: number;`

`src/live/merge.ts`:

```ts
  const first: Identity = {
    ...ids[0], name: l.name, handle: l.handle, state: STATE_MAP[l.state] ?? 'offline',
    task: l.degraded ? `${l.task} · degradada` : l.task, steps: l.steps, budget: l.budget, cost: l.costUsd, error: l.error,
    genMs: l.genMs ?? 0, degraded: l.degraded ?? false, earlyStopRemaining: l.earlyStopRemaining ?? 0,
  };
```
e em `liveLogFor`: `desc: t.provider ? `[${t.provider.split(':')[0]}] ${t.excerpt}` : t.excerpt`.

`src/state/fleetReducer.ts`: estado `readonly providerErrors: Partial<Record<RoleKey, string>>; readonly providerModels: Partial<Record<RoleKey, readonly string[]>>;` (inicial `{}` nos dois); ações:

```ts
  | { type: 'providerError'; role: RoleKey; message: string | null }
  | { type: 'providerModels'; role: RoleKey; models: readonly string[] }
```
casos:

```ts
    case 'providerError': {
      const { [a.role]: _drop, ...rest } = s.providerErrors;
      return { ...s, providerErrors: a.message ? { ...s.providerErrors, [a.role]: a.message } : rest };
    }
    case 'providerModels':
      return { ...s, providerModels: { ...s.providerModels, [a.role]: a.models } };
```

`src/state/selectors.ts`:
- `RoleVM` ganha `readonly models: readonly string[]; readonly error: string | null;`
- em `selectRoles`: `const model = modelFor(r.key, mode); … model, models: s.providerModels[r.key] ?? [model], error: s.providerErrors[r.key] ?? null,`
- `decorateTile`: `costFmt: d.genMs ? `${usd(d.cost)} · ${(d.genMs / 1000).toFixed(1).replace('.', ',')} s GPU` : usd(d.cost),`
- `selectSelStats`: `{ value: sel.earlyStopRemaining ? `${sel.steps}/${sel.budget} · ${sel.earlyStopRemaining} sobrando` : `${sel.steps}/${sel.budget}`, label: 'passos do orçamento' },`

`src/state/useFleet.ts` — `FleetActions` ganha `setProviderField(role, patch: { model?: string; endpoint?: string })` e `loadProviderModels(role)`; implementação:

```ts
      loadProviderModels: (role) => {
        const get = window.enxame?.getProviderModels; if (!get) return;
        get(role).then((r) => { dispatch({ type: 'providerModels', role, models: r.models }); if (r.error) dispatch({ type: 'providerError', role, message: r.error }); }).catch(() => undefined);
      },
      setProviderField: (role, patch) => {
        const set = window.enxame?.setProvider; if (!set) return;
        set(role, patch).then(() => dispatch({ type: 'providerError', role, message: null })).catch((e: Error) => dispatch({ type: 'providerError', role, message: e.message.replace(/^.*→ \d+: /, '').replace(/^\{"error":"|"\}$/g, '') }));
      },
```
e `pickMode` com bridge: `.then(() => { dispatch({ type: 'pickMode', role, mode }); dispatch({ type: 'providerError', role, message: null }); actionsRef.loadProviderModels(role); }).catch((e: Error) => dispatch({ type: 'providerError', role, message: <mesma limpeza> }))` — extrair a limpeza para `const bridgeMessage = (e: Error) => …` no topo do arquivo; para chamar `loadProviderModels` de dentro de `pickMode`, definir `loadProviderModels` como função local antes do `useMemo` e referenciá-la nos dois lugares.

`src/screens/Providers.tsx` — props novas `onSetField(role, patch)`, `onLoadModels(role)`; `useEffect(() => { roles.forEach((r) => onLoadModels(r.key)); }, [roles.map((r) => `${r.key}:${r.mode}`).join('|')])`; campos:

```tsx
            <label className="role__field"><span>Modelo</span>
              <select className="role__select" value={r.model} onChange={(e) => onSetField(r.key, { model: e.target.value })} aria-label={`Modelo do papel ${r.name}`}>
                {(r.models.includes(r.model) ? r.models : [r.model, ...r.models]).map((m) => (
                  <option key={m} value={m}>{m === r.model && !r.models.includes(m) ? `${m} (atual)` : m}</option>
                ))}
              </select>
            </label>
            {r.mode === 'local' ? (
              <label className="role__field"><span>Endpoint</span>
                <input className="role__input" defaultValue={r.endpoint} key={r.endpoint} aria-label={`Endpoint do papel ${r.name}`}
                  onBlur={(e) => { if (e.target.value !== r.endpoint) onSetField(r.key, { endpoint: e.target.value }); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
              </label>
            ) : (
              <div className="role__field"><span>Endpoint</span><div className="role__box role__box--mono">{r.endpoint}</div></div>
            )}
            {r.error && <div className="role__error" role="alert">{r.error}</div>}
```

`src/screens/Providers.css` — acrescentar:

```css
.role__select, .role__input { width: 100%; font: inherit; padding: 8px 10px; border: 1px solid var(--ink-20, #ccc); border-radius: 10px; background: var(--paper, #fff); }
.role__input { font-family: ui-monospace, monospace; }
.role__error { color: var(--danger, #b3261e); font-size: 13px; margin-top: 6px; }
```

`src/App.tsx`: passar `onSetField={actions.setProviderField}` e `onLoadModels={actions.loadProviderModels}` para `<Providers>`.

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run && npx tsc -b --noEmit && npx tsc -p tsconfig.electron.json --noEmit`
Expected: PASS (todos os novos); tsc limpos

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts electron/provider-route.ts electron/provider-route.test.ts electron/main.ts electron/preload.ts electron/daemon-bridge.ts src/live/types.ts src/live/merge.ts src/live/merge.test.ts src/types/fleet.ts src/state/fleetReducer.ts src/state/fleetReducer.test.ts src/state/selectors.ts src/state/selectors.test.ts src/state/useFleet.ts src/screens/Providers.tsx src/screens/Providers.css src/App.tsx
git commit -m "feat(ui): tela Provedores com seletor de modelos, endpoint editável e erro de PUT; métricas de GPU/degradação/sobra; IPC validado"
```

---

### Task 7: Integração com Ollama real, notas de spec e verificação na tela

**Files:**
- Create: `daemon/test/integration/ollama.integration.test.ts`
- Modify: `docs/superpowers/specs/2026-09-26-incremento-2-provedor-local-design.md` (§4.5, §4.6: ponteiros para o inc. 3), `docs/superpowers/specs/2026-09-26-incremento-3-endurecimento-design.md` (resultado)

**Interfaces:** consome tudo; nada novo.

- [ ] **Step 1: Teste de integração (skip sem a variável)**

`daemon/test/integration/ollama.integration.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/config.js';
import { createAdb } from '../../src/device/adb.js';
import { openDb } from '../../src/db/open.js';
import { getIdentity } from '../../src/db/identities.js';
import { daemonAlive } from '../../src/fleet/lock.js';
import { ensureIdentityReady } from '../../src/fleet/identity.js';
import { readProviderConfig, updateProvider } from '../../src/provider/config.js';
import { createOllamaSupervisor } from '../../src/provider/ollama.js';
import { testProvider } from '../../src/provider/probe.js';

const on = !!process.env.ENXAME_INTEGRATION;
const reason = !on ? 'ENXAME_INTEGRATION não definido' : daemonAlive(CONFIG.daemonInfoPath) ? 'daemon vivo disputa device e Ollama' : null;

const ownProcesses = () => readdirSync('/proc').filter((d) => /^\d+$/.test(d)).filter((p) => {
  try { return /ollama\0serve/.test(readFileSync(`/proc/${p}/cmdline`, 'utf8')) && readFileSync(`/proc/${p}/environ`, 'utf8').includes('OLLAMA_CONTEXT_LENGTH=32768'); } catch { return false; }
});

describe.skipIf(!!reason)(`Ollama real (ENXAME_INTEGRATION=1)${reason ? ` — pulado: ${reason}` : ''}`, () => {
  it('ensure → running e nosso; testProvider(worker) real → args válidos sem aviso; stop() limpa', async () => {
    const db = openDb(CONFIG.dbPath); const adb = createAdb(); const sup = createOllamaSupervisor();
    const id = getIdentity(db, 'conta1'); expect(id).toBeTruthy();
    const probe = await ensureIdentityReady(db, id!, { adb }); expect(probe.ready, probe.details.join('; ')).toBe(true);
    const before = readProviderConfig(db).worker;
    try {
      updateProvider(db, 'worker', { mode: 'local', model: 'gpt-oss:20b', endpoint: 'http://127.0.0.1:11434/v1' });
      const st = await sup.ensure('http://127.0.0.1:11434/v1', 'gpt-oss:20b');
      expect(st.running).toBe(true); expect(st.spawnedByUs || st.adopted).toBe(true);
      const t = await testProvider(db, readProviderConfig(db).worker, getIdentity(db, 'conta1')!, { anthropicApiKey: process.env.ANTHROPIC_API_KEY }, { ollama: sup });
      expect(t).toMatchObject({ argsValid: true, warning: null, error: null });
      sup.stop(); await new Promise((r) => setTimeout(r, 1500));
      expect(ownProcesses()).toEqual([]);
    } finally { updateProvider(db, 'worker', { mode: before.mode, model: before.model, endpoint: before.endpoint === 'anthropic' ? undefined : before.endpoint }); }
  }, 180_000);
});
```

- [ ] **Step 2: Rodar sem a variável e com ela**

Run: `npx vitest run --project daemon daemon/test/integration/ollama.integration.test.ts`
Expected: 1 skipped.

Pré-condição para o real: pare o daemon (`kill <pid de daemon.json>`; ele derruba o Ollama próprio ao sair). Run: `ENXAME_INTEGRATION=1 npx vitest run --project daemon daemon/test/integration/ollama.integration.test.ts`
Expected: PASS em < 3 min (carga do modelo incluída). Depois: `npm run daemon:build && (nohup node --env-file=.env dist-daemon/index.js > .verify/daemon.log 2>&1 &)` para subir o daemon de novo.

- [ ] **Step 3: Notas de spec**

Spec 2 §4.5: acrescentar "**Atualizado no incremento 3:** erro de parâmetro do servidor MCP também conta (ver `2026-09-26-incremento-3-endurecimento-design.md` §4.1)." Spec 2 §4.6: "**Entregue no incremento 3** (§4.5 daquele spec): seletor de modelos, endpoint editável, erro de PUT no card." Spec 3: parágrafo **Resultado (data)** com o que a integração mediu (latência, tok/s do teste real) e a confirmação visual do Step 4.

- [ ] **Step 4: Verificação na tela real**

Run: `npm run electron:dev` (com `--no-sandbox` se necessário) → tela Provedores.
Expected: (a) select do worker lista os modelos do disco e `gpt-oss:20b` selecionado; trocar para `gemma4:12b` persiste (recarregar mantém); (b) editar o endpoint para `ftp://x` mostra "endpoint precisa ser http(s)" em vermelho; voltar para `http://127.0.0.1:11434/v1` limpa; (c) com um objetivo em execução, clicar no toggle mostra "objetivo ou teste em execução…"; (d) no Cockpit, o tile da conta1 mostra "US$ … · N s GPU" e, se a última tarefa foi `done` com sobra, o painel mostra "17/30 · 13 sobrando". Registrar o que foi visto no parágrafo Resultado do spec 3. Ao final, deixar o worker em `gpt-oss:20b`.

- [ ] **Step 5: Suíte e commit**

Run: `npx vitest run && npx tsc -p tsconfig.daemon.json --noEmit && npx tsc -b --noEmit && npx tsc -p tsconfig.electron.json --noEmit`
Expected: verde

```bash
git add daemon/test/integration/ollama.integration.test.ts docs/superpowers/specs/2026-09-26-incremento-2-provedor-local-design.md docs/superpowers/specs/2026-09-26-incremento-3-endurecimento-design.md
git commit -m "test(integration): Ollama real via supervisor e probe; notas de spec do incremento 3"
```

---

## Self-review

- **Cobertura do spec 3:** §4.1 → T1; §4.2 → T2 (+T6 exibição); §4.3 → T3; §4.4 → T2 (`auth`, orçamento), T4 (endpoint, loopback, log, seed, API); §4.5 → T5 (rota) + T6 (tela, IPC, snapshot na identidade); §4.6 → T5 (`lock.ts`, bench/run-real) + T7 (integração); §5 → T2 (migração); §6 → cada linha tem tarefa; §7 → T7; mapa §9 → todos os 13 têm tarefa.
- **Placeholders:** nenhum; o único "mesma limpeza" em T6 aponta para `bridgeMessage` definido na própria tarefa.
- **Consistência de tipos:** `earlyStopRemaining` com o mesmo nome em `RunTaskResult` (T2), `IdentitySnapshot` (T2), `LiveIdentity`/`Identity` (T6); `providerRoute(role, 'put'|'test'|'models')` usado em `main.ts` (T6); `daemonAlive(infoPath, isAlive?)` (T5) usado em T7; `seedProviderConfig` (T4) chamado por `openDb` (T4) e implicitamente em `updateProvider`; `CLOUD_MODELS` (T4) usado por T5; `patchErrorMessage` (T4) usado em `api.ts` (T4).
- **Review Focus:** 1 → T5 + T6 (`selectRoles`); 2 → T4; 3 → T1; 4 → T6 (reducer); 5 → T2. Todos com teste nomeado.
