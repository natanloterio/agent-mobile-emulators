# Enxame — Incremento 1: uma identidade real ponta a ponta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um daemon local gerencia **uma** identidade (o emulador `mcp_test_playstore` já provisionado), um worker com LLM real executa uma tarefa **somente-leitura** no Instagram através do servidor MCP do device, e o Cockpit/Device do app Electron mostram o estado vivo dessa identidade — com custo em tokens medido e nenhuma ação irreversível.

**Architecture:** O daemon é um processo Node ≥ 24 separado do Electron (o Electron 33 embute Node 20.18, sem `node:sqlite`), dono de `adb`, da sonda de prontidão, do SQLite e do loop do worker; expõe HTTP + WebSocket em `127.0.0.1` com token. O Electron `main` sobe o daemon, conecta no WebSocket e repassa snapshots ao renderer por IPC via `preload`; o renderer sobrepõe os dados vivos da identidade 0 ao mock existente sem tocar nas telas. O worker usa `generateText` do AI SDK 7 com tools vindas do `@ai-sdk/mcp`: `prepareStep` poda o histórico, `toolApproval` é o gate determinístico, `onStepFinish` grava passo e custo.

**Tech Stack:** Node 26 (`node:sqlite`, `--env-file`), TypeScript 5.7 estrito, `ai@7.0.116`, `@ai-sdk/anthropic@4.0.65`, `@ai-sdk/mcp@2.0.60`, `ws@8.21`, `zod@4.6`, `vitest@5`, Electron 33, React 18 (já existentes).

**Spec:** `docs/superpowers/specs/2026-09-26-android-swarm-design.md` (§3 restrições medidas, §4.1 identidade, §4.3 orquestração, §4.4 provedores, §6 erros, §7 testes, §8 modelo de dados, §9 faseamento — este plano cobre a **fase 1** e o mínimo da **fase 2**).

> **Errata (revisão final, 2026-09-26):** o código da Task 8 no plano tinha dois erros de contrato com o ai@7 que os
> testes com fakes não pegavam: (1) `role:'system'` dentro de `messages` é rejeitado (`allowSystemInMessages=false`) — o
> system vai em `instructions`; (2) `StepResult.toolResults[].output` é o valor cru e erros/negações vêm em
> `StepResult.content` como `tool-error` e `tool-approval-response{approved:false}` — `recordStep` lê `content`.
> A correção está em `daemon/test/real-sdk.test.ts` (generateText real + `MockLanguageModelV4`) e no commit da passada de correção.

> Além de C1/C2, a revisão final apontou I1–I11 (gate com tela velha e tool use paralelo; rótulos por palavra e
> descendentes; paginação real; classificação de falhas por origem; isError do MCP; ensureIdentityReady sem lançar e
> recusando needs-human; lastError limpável; write-ahead antes da execução; single-flight e killed único). Todos
> corrigidos com testes RED→GREEN; menores diferidos no ledger. Commits `367fba9`, `aaedf3a`, `df936ca`.

## Global Constraints

- Alvo de escala **8 identidades**; teto duro **16** pela varredura de portas do adb (5555–5585). Este incremento roda **1**.
- Emulador sobe com **`emulator -port <console_port>`** (singular); porta é **lease persistido**, nunca fórmula do índice. Se a porta estiver presa, lease do próximo slot.
- **adb server isolado:** todo `adb` do daemon roda com `ANDROID_ADB_SERVER_PORT=5038` e binário fixo `/home/loterio/Android/Sdk/platform-tools/adb` (37.0.0). Nunca o `/usr/bin/adb` (34.0.4).
- **Sonda de 5 sinais** antes de qualquer tarefa: `sys.boot_completed=1`; accessibility service ativo; `initialize` MCP OK; **tools que o workload usa presentes** (nunca contagem); `versionName` do app alvo igual ao registrado.
- **Token e `device_slug` por identidade**, aplicados por broadcast `ADB_CONFIGURE` pós-clone; nunca na imagem-base.
- **Poda de histórico:** o modelo vê no máximo os **2** últimos `get_screen_state`.
- **Ledger antes de agir:** item já tratado nunca é tratado de novo. **Intenção write-ahead** com `idempotency_key` antes de toda tool call.
- **Bloqueio de plataforma** (checkpoint, captcha, deslogou) → identidade para em `needs-human`; **nunca retry automático**.
- Este incremento é **somente-leitura no Instagram**: o gate nega toque em nós cujo texto/desc case com enviar/publicar/postar/responder/compartilhar/pagar/confirmar, e nega `press_key ENTER`.
- Modelos: worker **`claude-haiku-4-5`**; escalonamento **`claude-sonnet-5`** (não usado neste incremento, mas o campo existe). Prompt caching com `cacheControl: { type: 'ephemeral', ttl: '1h' }` no system.
- Constantes de host (§3): RSS 4,6 GB/emulador, `hw.ramSize=2G`, 636 MiB VRAM/emulador — só informativas aqui.
- Arquivos TypeScript **< 300 linhas**; funções **< 50 linhas**; dados imutáveis (nunca mutar objeto existente). Validar toda entrada externa com `zod` na borda.
- Package id do app MCP no device: `com.danielealbano.androidremotecontrolmcp.gms.debug`. App alvo: `com.instagram.android`, versão registrada `448.0.0.52.84`.

## Review Focus

Entradas que o spec implica e que nenhum teste de tarefa cobriria sem estas linhas — cada uma tem seu teste na tarefa dona:

1. **MCP responde 401 no meio de uma tarefa** (token rotacionado no app): a tarefa deve terminar em `failed` com classe `infra`, o device em `offline`, e **nenhum** retry de tool call. Teste em Task 8.
2. **Screen state paginado** (`cursor` na resposta em telas densas): o parser deve expor `cursor` e o worker deve seguir a paginação em vez de tratar a tela como completa. Teste em Task 2.
3. **Emulador morre entre dois passos** (`adb: device 'emulator-5554' not found`): classe `infra`, tarefa volta para `todo`, identidade para `offline`; **não** vira `needs-human`. Teste em Task 5 e Task 8.
4. **Modelo chama tool fora do subset** (nome alucinado) ou a tool devolve erro: o SDK entrega o resultado como `error-text`; o registro deve gravar `error` e excerpt `ERRO …`, contar no orçamento e **não** interromper a tarefa. Teste em Task 8.
5. **Tela de checkpoint do Instagram** ("Confirme que é você", "Suspicious login", "Ajude-nos a confirmar"): detectada pelo parser, para a identidade em `needs-human` com `error` preenchido e **encerra** o loop antes do próximo passo. Teste em Task 2 e Task 8.

---

## Estrutura de arquivos

```
package.json                     # + scripts daemon:*, test, real:run; engines.node >=24
tsconfig.daemon.json             # daemon/src → dist-daemon, module NodeNext, types node
vitest.config.ts                 # dois projetos: daemon (node) e renderer (node)
.env.example                     # ANTHROPIC_API_KEY=
daemon/src/index.ts              # entrada: abre db, sobe server, registra identidade
daemon/src/config.ts             # paths (data dir), constantes de host, env validado com zod
daemon/src/db/schema.ts          # SQL do §8 (identity, goal, task, step, ledger, decision_sample)
daemon/src/db/open.ts            # openDb(path) com node:sqlite
daemon/src/db/identities.ts      # upsert/get/updateState
daemon/src/db/tasks.ts           # goal/task/step/ledger — escritor único
daemon/src/screen/parse.ts       # texto do get_screen_state → ScreenState tipado
daemon/src/screen/checks.ts      # perguntas computáveis: editáveis, achar por texto, checkpoint
daemon/src/device/adb.ts         # adb isolado (porta 5038), com runner injetável
daemon/src/device/mcp.ts         # createMCPClient http+bearer (subset fica em worker/tools.ts)
daemon/src/device/probe.ts       # sonda de 5 sinais
daemon/src/fleet/ports.ts        # lease de porta com verificação real de socket
daemon/src/fleet/identity.ts     # ciclo de vida + forward + slug/token por broadcast
daemon/src/worker/tools.ts       # subset de 11 tools por sufixo
daemon/src/worker/gate.ts        # toolApproval determinístico
daemon/src/worker/prune.ts       # prepareStep: manter 2 screen states
daemon/src/worker/record.ts      # onStepFinish → step + custo + ledger
daemon/src/worker/prompt.ts      # system prompt e instrução somente-leitura
daemon/src/worker/run.ts         # runTask(): generateText com tudo acima
daemon/src/server/api.ts         # HTTP: GET /state, POST /goals, POST /kill
daemon/src/server/ws.ts          # WS: snapshot a cada mudança
daemon/src/server/snapshot.ts    # FleetSnapshot (contrato com o renderer)
daemon/src/cli/run-real.ts       # execução real medida + relatório em docs/
daemon/test/fixtures/screens.json     # copiado de /tmp/.../screens.json
daemon/test/fixtures/checkpoint.txt   # tela sintética de checkpoint
daemon/test/**/*.test.ts
electron/main.ts                 # + spawn do daemon, WS client, IPC → renderer
electron/preload.ts              # + enxame.onSnapshot / startGoal / kill
electron/daemon-bridge.ts        # cliente WS/HTTP do daemon (fora do main.ts)
src/live/types.ts                # FleetSnapshot espelhado (mesmo shape do daemon)
src/live/useLiveFleet.ts         # assina window.enxame; null sem Electron
src/live/merge.ts                # sobrepõe identidade viva ao mock (índice 0)
src/App.tsx                      # usa merge; Device usa log vivo quando existir
src/live/merge.test.ts
```

---

### Task 1: Scaffold do daemon, config e banco

**Files:**
- Create: `tsconfig.daemon.json`, `vitest.config.ts`, `.env.example`
- Create: `daemon/src/config.ts`, `daemon/src/db/schema.ts`, `daemon/src/db/open.ts`, `daemon/src/db/identities.ts`
- Test: `daemon/test/db.test.ts`
- Modify: `package.json` (scripts, engines)

**Interfaces:**
- Produces: `openDb(path: string): DatabaseSync`; `SCHEMA: string`; `upsertIdentity(db, IdentityRow): void`; `getIdentity(db, id): IdentityRow | null`; `setIdentityState(db, id, state, patch?)`; `type IdentityRow`; `type IdentityState = 'blank'|'provisioned'|'logged-in'|'running'|'dirty'|'restored'|'banned'|'offline'|'needs-human'|'idle'`; `CONFIG` (paths e constantes); `loadEnv(): { anthropicApiKey: string }`.

- [ ] **Step 1: Scripts e tsconfig**

`package.json` — acrescentar dentro de `scripts` e adicionar `engines`:

```json
"daemon:build": "tsc -p tsconfig.daemon.json",
"daemon:start": "node --env-file=.env dist-daemon/index.js",
"test": "vitest run",
"test:integration": "ENXAME_INTEGRATION=1 vitest run --project daemon",
"real:run": "npm run daemon:build && node --env-file=.env dist-daemon/cli/run-real.js"
```

```json
"engines": { "node": ">=24" }
```

`tsconfig.daemon.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022", "lib": ["ES2022"], "module": "NodeNext", "moduleResolution": "NodeNext",
    "strict": true, "noUnusedLocals": true, "noUnusedParameters": true, "skipLibCheck": true,
    "outDir": "dist-daemon", "rootDir": "daemon/src", "types": ["node"], "declaration": false
  },
  "include": ["daemon/src"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'daemon', environment: 'node', include: ['daemon/test/**/*.test.ts'] } },
      { test: { name: 'renderer', environment: 'node', include: ['src/**/*.test.ts'] } },
    ],
  },
});
```

`.env.example`:

```
ANTHROPIC_API_KEY=
```

Acrescentar `.env` e `dist-daemon/` ao `.gitignore`.

- [ ] **Step 2: Teste do banco (falha)**

`daemon/test/db.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { getIdentity, setIdentityState, upsertIdentity } from '../src/db/identities.js';

const row = {
  id: 'conta1', name: 'conta1', handle: '@aurora.moda', avdName: 'mcp_test_playstore', serial: 'emulator-5554',
  consolePort: 5554, mcpHostPort: 8080, mcpToken: 'tok', deviceSlug: 'conta1',
  appPackage: 'com.instagram.android', appVersionName: '448.0.0.52.84', state: 'logged-in' as const,
};

describe('identities', () => {
  it('cria o schema e faz upsert idempotente', () => {
    const db = openDb(':memory:');
    upsertIdentity(db, row);
    upsertIdentity(db, { ...row, handle: '@nova' });
    expect(getIdentity(db, 'conta1')?.handle).toBe('@nova');
    expect(db.prepare('select count(*) as n from identity').get()).toEqual({ n: 1 });
  });
  it('setIdentityState grava estado e patch sem mutar o objeto de entrada', () => {
    const db = openDb(':memory:');
    upsertIdentity(db, row);
    setIdentityState(db, 'conta1', 'needs-human', { bannedReason: null, lastError: 'checkpoint' });
    const got = getIdentity(db, 'conta1');
    expect(got?.state).toBe('needs-human');
    expect(got?.lastError).toBe('checkpoint');
    expect(row.state).toBe('logged-in');
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run --project daemon daemon/test/db.test.ts`
Expected: FAIL — `Cannot find module '../src/db/open.js'`

- [ ] **Step 4: Implementar schema, open e identities**

`daemon/src/db/schema.ts`:

```ts
export const SCHEMA = `
create table if not exists identity (
  id text primary key, name text not null, handle text not null, avd_name text not null, serial text not null,
  console_port integer not null, mcp_host_port integer not null, mcp_token text not null, device_slug text not null,
  app_package text not null, app_version_name text not null, state text not null,
  lease_owner text, lease_expires_at text, snapshot_taken_at text, banned_reason text, banned_at text,
  last_error text, updated_at text not null default (datetime('now'))
);
create table if not exists goal (
  id text primary key, text text not null, pattern text not null, state text not null,
  created_at text not null default (datetime('now')), cost_usd real not null default 0
);
create table if not exists task (
  id text primary key, goal_id text not null references goal(id), identity_id text references identity(id),
  instruction text not null, state text not null, attempts integer not null default 0,
  cost_usd real not null default 0, created_at text not null default (datetime('now')), finished_at text
);
create table if not exists step (
  id integer primary key autoincrement, task_id text not null references task(id), idx integer not null,
  tool text, args_json text, result_excerpt text, input_tokens integer, output_tokens integer,
  cache_read_tokens integer, latency_ms integer, escalated integer not null default 0,
  idempotency_key text, intent_written_at text not null, started_at text, finished_at text, error text
);
create table if not exists ledger (
  identity_id text not null references identity(id), item_key text not null, kind text not null,
  note text, created_at text not null default (datetime('now')), primary key (identity_id, item_key)
);
create table if not exists decision_sample (
  id integer primary key autoincrement, step_id integer references step(id), reduced_state text not null,
  question text not null, model_answer text, label text, label_origin text check (label_origin in ('outcome','human','model'))
);
`;
```

`daemon/src/db/open.ts`:

```ts
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA } from './schema.js';

export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('pragma journal_mode = wal; pragma foreign_keys = on;');
  db.exec(SCHEMA);
  return db;
}
```

`daemon/src/db/identities.ts`:

```ts
import type { DatabaseSync } from 'node:sqlite';

export type IdentityState =
  | 'blank' | 'provisioned' | 'logged-in' | 'running' | 'dirty' | 'restored' | 'banned'
  | 'offline' | 'needs-human' | 'idle';

export interface IdentityRow {
  readonly id: string; readonly name: string; readonly handle: string; readonly avdName: string; readonly serial: string;
  readonly consolePort: number; readonly mcpHostPort: number; readonly mcpToken: string; readonly deviceSlug: string;
  readonly appPackage: string; readonly appVersionName: string; readonly state: IdentityState;
  readonly lastError?: string | null; readonly bannedReason?: string | null; readonly snapshotTakenAt?: string | null;
}

const COLS = ['id','name','handle','avd_name','serial','console_port','mcp_host_port','mcp_token','device_slug','app_package','app_version_name','state'] as const;

export function upsertIdentity(db: DatabaseSync, r: IdentityRow): void {
  const sets = COLS.filter((c) => c !== 'id').map((c) => `${c}=excluded.${c}`).join(', ');
  db.prepare(`insert into identity (${COLS.join(',')}) values (${COLS.map(() => '?').join(',')})
    on conflict(id) do update set ${sets}, updated_at=datetime('now')`)
    .run(r.id, r.name, r.handle, r.avdName, r.serial, r.consolePort, r.mcpHostPort, r.mcpToken, r.deviceSlug, r.appPackage, r.appVersionName, r.state);
}

function fromRow(x: Record<string, unknown>): IdentityRow {
  return {
    id: String(x.id), name: String(x.name), handle: String(x.handle), avdName: String(x.avd_name), serial: String(x.serial),
    consolePort: Number(x.console_port), mcpHostPort: Number(x.mcp_host_port), mcpToken: String(x.mcp_token),
    deviceSlug: String(x.device_slug), appPackage: String(x.app_package), appVersionName: String(x.app_version_name),
    state: x.state as IdentityState, lastError: (x.last_error as string | null) ?? null,
    bannedReason: (x.banned_reason as string | null) ?? null, snapshotTakenAt: (x.snapshot_taken_at as string | null) ?? null,
  };
}

export function getIdentity(db: DatabaseSync, id: string): IdentityRow | null {
  const x = db.prepare('select * from identity where id = ?').get(id) as Record<string, unknown> | undefined;
  return x ? fromRow(x) : null;
}

export function listIdentities(db: DatabaseSync): readonly IdentityRow[] {
  return (db.prepare('select * from identity order by id').all() as Record<string, unknown>[]).map(fromRow);
}

export function setIdentityState(
  db: DatabaseSync, id: string, state: IdentityState,
  patch: { lastError?: string | null; bannedReason?: string | null; snapshotTakenAt?: string | null } = {},
): void {
  db.prepare(`update identity set state=?, last_error=coalesce(?, last_error), banned_reason=coalesce(?, banned_reason),
    snapshot_taken_at=coalesce(?, snapshot_taken_at), updated_at=datetime('now') where id=?`)
    .run(state, patch.lastError ?? null, patch.bannedReason ?? null, patch.snapshotTakenAt ?? null, id);
}
```

`daemon/src/config.ts`:

```ts
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

const DATA_DIR = process.env.ENXAME_DATA_DIR ?? path.join(os.homedir(), '.local', 'share', 'enxame');

export const CONFIG = {
  dataDir: DATA_DIR,
  dbPath: path.join(DATA_DIR, 'enxame.sqlite'),
  daemonInfoPath: path.join(DATA_DIR, 'daemon.json'),
  adbPath: '/home/loterio/Android/Sdk/platform-tools/adb',
  adbServerPort: 5038,
  mcpAppPackage: 'com.danielealbano.androidremotecontrolmcp.gms.debug',
  targetApp: { package: 'com.instagram.android', versionName: '448.0.0.52.84' },
  models: { worker: 'claude-haiku-4-5', escalation: 'claude-sonnet-5' },
  ports: { consoleFrom: 5554, consoleMax: 5584, mcpHostFrom: 8080 },
  worker: { stepBudget: 30, keepScreens: 2 },
} as const;

const EnvSchema = z.object({ ANTHROPIC_API_KEY: z.string().min(20, 'ANTHROPIC_API_KEY ausente ou curta') });

export function loadEnv(): { anthropicApiKey: string } {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join('; '));
  return { anthropicApiKey: parsed.data.ANTHROPIC_API_KEY };
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run --project daemon daemon/test/db.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.daemon.json vitest.config.ts .env.example .gitignore daemon/
git commit -m "feat(daemon): scaffold, config validada e schema SQLite do §8"
```

---

### Task 2: Parser do screen state e perguntas computáveis

**Files:**
- Create: `daemon/src/screen/parse.ts`, `daemon/src/screen/checks.ts`
- Create: `daemon/test/fixtures/screens.json` (copiar de `/tmp/claude-1000/-media-loterio-workspace-workspace-pitaia-research/screens.json`), `daemon/test/fixtures/checkpoint.txt`
- Test: `daemon/test/screen.test.ts`

**Interfaces:**
- Produces: `parseScreen(text: string): ScreenState`; `type ScreenState = { width; height; cursor: string | null; windows: readonly ScreenWindow[] }`; `type ScreenNode = { id; cls; text; desc; resId; bounds: {l,t,r,b}; flags: ReadonlySet<string> }`; `focusedWindow(s)`, `editableNodes(s)`, `findNodes(s, re: RegExp)`, `nodeById(s, id)`, `detectPlatformBlock(s): string | null`.

- [ ] **Step 1: Fixture de checkpoint**

`daemon/test/fixtures/checkpoint.txt`:

```
screen:1080x2400 density:420 orientation:portrait
--- window:9 type:APPLICATION pkg:com.instagram.android title:Instagram activity:com.instagram.android.activity.MainTabActivity layer:0 focused:true ---
node_id	class	text	desc	res_id	bounds	flags
node_a1	TextView	Confirme que é você	-	-	100,600,980,700	on,ena
node_a2	TextView	Detectamos uma atividade incomum nesta conta.	-	-	100,720,980,800	on,ena
node_a3	Button	Continuar	-	-	100,900,980,1000	on,clk,foc,ena
hierarchy:
node_a1
node_a2
node_a3
```

- [ ] **Step 2: Teste (falha)**

`daemon/test/screen.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectPlatformBlock, editableNodes, findNodes, focusedWindow, nodeById } from '../src/screen/checks.js';
import { parseScreen } from '../src/screen/parse.js';

const S = JSON.parse(readFileSync(new URL('./fixtures/screens.json', import.meta.url), 'utf8')) as Record<string, string>;
const CK = readFileSync(new URL('./fixtures/checkpoint.txt', import.meta.url), 'utf8');

describe('parseScreen', () => {
  it('separa janelas e nós com bounds e flags', () => {
    const s = parseScreen(S.launcher);
    expect(s.width).toBe(1080);
    const w = focusedWindow(s);
    expect(w?.pkg).toBe('com.google.android.apps.nexuslauncher');
    const ig = findNodes(s, /^Instagram$/)[0];
    expect(ig?.bounds).toEqual({ l: 57, t: 223, r: 267, b: 495 });
    expect(ig?.flags.has('clk')).toBe(true);
  });
  it('não há nó editável no launcher, embora a busca seja clicável (regra de affordance do spec)', () => {
    const s = parseScreen(S.launcher);
    expect(editableNodes(s)).toHaveLength(0);
    expect(findNodes(s, /Search/).some((n) => n.flags.has('clk'))).toBe(true);
  });
  it('expõe cursor de paginação quando a resposta o traz', () => {
    const paged = S.play_store + '\nnext_cursor:abc123.2\n';
    expect(parseScreen(paged).cursor).toBe('abc123.2');
    expect(parseScreen(S.play_store).cursor).toBeNull();
  });
  it('nodeById acha em qualquer janela', () => {
    const s = parseScreen(S.mcp_app_settings);
    expect(nodeById(s, 'node_72cfd38d')?.text).toBe('Server');
  });
});

describe('detectPlatformBlock', () => {
  it('reconhece checkpoint do Instagram', () => {
    expect(detectPlatformBlock(parseScreen(CK))).toMatch(/Confirme que é você/);
  });
  it('não dispara em tela normal', () => {
    expect(detectPlatformBlock(parseScreen(S.launcher))).toBeNull();
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cp /tmp/claude-1000/-media-loterio-workspace-workspace-pitaia-research/screens.json daemon/test/fixtures/ && npx vitest run --project daemon daemon/test/screen.test.ts`
Expected: FAIL — módulos inexistentes

- [ ] **Step 4: Implementar parser e checks**

`daemon/src/screen/parse.ts`:

```ts
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
```

`daemon/src/screen/checks.ts`:

```ts
import type { ScreenNode, ScreenState, ScreenWindow } from './parse.js';

export function focusedWindow(s: ScreenState): ScreenWindow | null {
  return s.windows.find((w) => w.focused) ?? s.windows.find((w) => w.type === 'APPLICATION') ?? null;
}

export function allNodes(s: ScreenState): readonly ScreenNode[] {
  return s.windows.flatMap((w) => w.nodes);
}

export function nodeById(s: ScreenState, id: string): ScreenNode | null {
  return allNodes(s).find((n) => n.id === id) ?? null;
}

/** Nó editável de fato (flag `edt`), não "parece campo". Ver spec §4.5, lição 2. */
export function editableNodes(s: ScreenState): readonly ScreenNode[] {
  return allNodes(s).filter((n) => n.flags.has('edt'));
}

export function findNodes(s: ScreenState, re: RegExp): readonly ScreenNode[] {
  return allNodes(s).filter((n) => re.test(n.text) || re.test(n.desc));
}

const BLOCK_PATTERNS: readonly RegExp[] = [
  /confirme que é você/i, /confirm it's you/i, /suspicious login/i, /atividade incomum/i,
  /ajude-nos a confirmar/i, /help us confirm/i, /we suspended your account/i, /sua conta foi suspensa/i,
  /insira o código/i, /enter the code we sent/i, /captcha/i,
];

/** Texto do bloqueio de plataforma, ou null. Uma vez detectado, a identidade para (spec §6). */
export function detectPlatformBlock(s: ScreenState): string | null {
  const w = focusedWindow(s);
  if (!w || !w.pkg.startsWith('com.instagram')) return null;
  for (const n of w.nodes) {
    const hay = `${n.text} ${n.desc}`;
    if (BLOCK_PATTERNS.some((re) => re.test(hay))) return (n.text || n.desc).slice(0, 200);
  }
  return null;
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run --project daemon daemon/test/screen.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add daemon/src/screen daemon/test/screen.test.ts daemon/test/fixtures
git commit -m "feat(daemon): parser do screen state, checks computáveis e detecção de checkpoint"
```

---

### Task 3: Adapter do adb isolado

**Files:**
- Create: `daemon/src/device/adb.ts`
- Test: `daemon/test/adb.test.ts`

**Interfaces:**
- Produces: `type Exec = (file: string, args: readonly string[], env: NodeJS.ProcessEnv) => Promise<{ stdout: string; stderr: string; code: number }>`; `createAdb(deps?: { exec?: Exec; adbPath?: string; serverPort?: number }): Adb`; `interface Adb { devices(): Promise<readonly string[]>; getprop(serial, key): Promise<string>; settingsGetSecure(serial, key): Promise<string>; versionName(serial, pkg): Promise<string | null>; forward(serial, hostPort, devicePort): Promise<void>; broadcastConfigure(serial, extras: Record<string, string | number | boolean>): Promise<void>; startTrampoline(serial, action: 'start' | 'stop'): Promise<void> }`; `class AdbError extends Error { readonly kind: 'device-missing' | 'command' }`.

- [ ] **Step 1: Teste (falha)**

`daemon/test/adb.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { AdbError, createAdb, type Exec } from '../src/device/adb.js';

function fakeExec(map: Record<string, { stdout?: string; code?: number; stderr?: string }>): { exec: Exec; calls: string[][] } {
  const calls: string[][] = [];
  const exec: Exec = async (_file, args) => {
    calls.push([...args]);
    const key = args.join(' ');
    const hit = Object.entries(map).find(([k]) => key.includes(k));
    return { stdout: hit?.[1].stdout ?? '', stderr: hit?.[1].stderr ?? '', code: hit?.[1].code ?? 0 };
  };
  return { exec, calls };
}

describe('adb isolado', () => {
  it('usa o binário do SDK e ANDROID_ADB_SERVER_PORT=5038 em toda chamada', async () => {
    const seen: NodeJS.ProcessEnv[] = [];
    const exec: Exec = async (file, _a, env) => { seen.push(env); expect(file).toBe('/home/loterio/Android/Sdk/platform-tools/adb'); return { stdout: 'List of devices attached\nemulator-5554\tdevice\n', stderr: '', code: 0 }; };
    const adb = createAdb({ exec });
    expect(await adb.devices()).toEqual(['emulator-5554']);
    expect(seen[0].ANDROID_ADB_SERVER_PORT).toBe('5038');
  });
  it('versionName extrai do dumpsys', async () => {
    const { exec } = fakeExec({ 'dumpsys package com.instagram.android': { stdout: '    versionName=448.0.0.52.84\n' } });
    expect(await createAdb({ exec }).versionName('emulator-5554', 'com.instagram.android')).toBe('448.0.0.52.84');
  });
  it('device ausente vira AdbError kind=device-missing', async () => {
    const { exec } = fakeExec({ 'getprop': { code: 1, stderr: "adb: device 'emulator-5554' not found" } });
    await expect(createAdb({ exec }).getprop('emulator-5554', 'sys.boot_completed')).rejects.toMatchObject({ kind: 'device-missing' } satisfies Partial<AdbError>);
  });
  it('broadcastConfigure monta --es/--ez/--ei pelo tipo do valor', async () => {
    const { exec, calls } = fakeExec({});
    await createAdb({ exec }).broadcastConfigure('emulator-5554', { bearer_token: 'abc', bearer_token_enabled: true, port: 8080 });
    const args = calls[0].join(' ');
    expect(args).toContain('--es bearer_token abc');
    expect(args).toContain('--ez bearer_token_enabled true');
    expect(args).toContain('--ei port 8080');
    expect(args).toContain('com.danielealbano.androidremotecontrolmcp.ADB_CONFIGURE');
  });
  it('forward chama adb forward tcp:host tcp:device', async () => {
    const { exec, calls } = fakeExec({});
    await createAdb({ exec }).forward('emulator-5554', 8081, 8080);
    expect(calls[0]).toEqual(['-s', 'emulator-5554', 'forward', 'tcp:8081', 'tcp:8080']);
  });
  it('spy: getprop devolve valor sem \\r', async () => {
    const exec = vi.fn<Exec>(async () => ({ stdout: '1\r\n', stderr: '', code: 0 }));
    expect(await createAdb({ exec }).getprop('emulator-5554', 'sys.boot_completed')).toBe('1');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --project daemon daemon/test/adb.test.ts`
Expected: FAIL — módulo inexistente

- [ ] **Step 3: Implementar**

`daemon/src/device/adb.ts`:

```ts
import { execFile } from 'node:child_process';
import { CONFIG } from '../config.js';

export type Exec = (file: string, args: readonly string[], env: NodeJS.ProcessEnv) => Promise<{ stdout: string; stderr: string; code: number }>;

export class AdbError extends Error {
  constructor(readonly kind: 'device-missing' | 'command', message: string) { super(message); this.name = 'AdbError'; }
}

const defaultExec: Exec = (file, args, env) =>
  new Promise((resolve) => {
    execFile(file, [...args], { env, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err && typeof (err as NodeJS.ErrnoException & { code?: number }).code === 'number' ? Number((err as { code?: number }).code) : err ? 1 : 0;
      resolve({ stdout: String(stdout), stderr: String(stderr), code });
    });
  });

const MCP_PKG = CONFIG.mcpAppPackage;
const CONFIGURE_ACTION = 'com.danielealbano.androidremotecontrolmcp.ADB_CONFIGURE';
const CONFIGURE_RECEIVER = 'com.danielealbano.androidremotecontrolmcp.services.mcp.AdbConfigReceiver';
const TRAMPOLINE = 'com.danielealbano.androidremotecontrolmcp.services.mcp.AdbServiceTrampolineActivity';

function extraArgs(extras: Record<string, string | number | boolean>): readonly string[] {
  return Object.entries(extras).flatMap(([k, v]) =>
    typeof v === 'boolean' ? ['--ez', k, String(v)] : typeof v === 'number' ? ['--ei', k, String(v)] : ['--es', k, v]);
}

export interface Adb {
  devices(): Promise<readonly string[]>;
  getprop(serial: string, key: string): Promise<string>;
  settingsGetSecure(serial: string, key: string): Promise<string>;
  versionName(serial: string, pkg: string): Promise<string | null>;
  forward(serial: string, hostPort: number, devicePort: number): Promise<void>;
  broadcastConfigure(serial: string, extras: Record<string, string | number | boolean>): Promise<void>;
  startTrampoline(serial: string, action: 'start' | 'stop'): Promise<void>;
}

export function createAdb(deps: { exec?: Exec; adbPath?: string; serverPort?: number } = {}): Adb {
  const exec = deps.exec ?? defaultExec;
  const adbPath = deps.adbPath ?? CONFIG.adbPath;
  const env = { ...process.env, ANDROID_ADB_SERVER_PORT: String(deps.serverPort ?? CONFIG.adbServerPort) };

  async function run(args: readonly string[]): Promise<string> {
    const r = await exec(adbPath, args, env);
    if (r.code !== 0) {
      const msg = (r.stderr || r.stdout).trim();
      throw new AdbError(/not found|offline|no devices/i.test(msg) ? 'device-missing' : 'command', msg || `adb ${args.join(' ')} falhou`);
    }
    return r.stdout.replace(/\r/g, '').trim();
  }
  const shell = (serial: string, cmd: readonly string[]) => run(['-s', serial, 'shell', ...cmd]);

  return {
    devices: async () => (await run(['devices'])).split('\n').slice(1).filter((l) => l.endsWith('\tdevice')).map((l) => l.split('\t')[0]),
    getprop: (serial, key) => shell(serial, ['getprop', key]),
    settingsGetSecure: (serial, key) => shell(serial, ['settings', 'get', 'secure', key]),
    versionName: async (serial, pkg) => /versionName=(\S+)/.exec(await shell(serial, ['dumpsys', 'package', pkg]))?.[1] ?? null,
    forward: async (serial, hostPort, devicePort) => { await run(['-s', serial, 'forward', `tcp:${hostPort}`, `tcp:${devicePort}`]); },
    broadcastConfigure: async (serial, extras) => {
      await shell(serial, ['am', 'broadcast', '-a', CONFIGURE_ACTION, '-n', `${MCP_PKG}/${CONFIGURE_RECEIVER}`, ...extraArgs(extras)]);
    },
    startTrampoline: async (serial, action) => { await shell(serial, ['am', 'start', '-n', `${MCP_PKG}/${TRAMPOLINE}`, '--es', 'action', action]); },
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run --project daemon daemon/test/adb.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Teste de integração opcional contra o emulador**

Acrescentar ao fim de `daemon/test/adb.test.ts`:

```ts
describe.skipIf(!process.env.ENXAME_INTEGRATION)('adb real (ENXAME_INTEGRATION=1)', () => {
  it('enxerga emulator-5554 com boot completo', async () => {
    const adb = createAdb();
    expect(await adb.devices()).toContain('emulator-5554');
    expect(await adb.getprop('emulator-5554', 'sys.boot_completed')).toBe('1');
  });
});
```

Run: `ENXAME_INTEGRATION=1 npx vitest run --project daemon daemon/test/adb.test.ts`
Expected: PASS (7 tests) com o emulador de pé; sem ele, 6 PASS + 1 skipped.

- [ ] **Step 6: Commit**

```bash
git add daemon/src/device/adb.ts daemon/test/adb.test.ts
git commit -m "feat(daemon): adb isolado em porta própria, binário pinado e erros tipados"
```

---

### Task 4: Cliente MCP e subset de tools

**Files:**
- Create: `daemon/src/device/mcp.ts`, `daemon/src/worker/tools.ts`
- Test: `daemon/test/mcp.test.ts`, `daemon/test/tools.test.ts`

**Interfaces:**
- Consumes: nada do projeto.
- Produces: `connectMcp(url: string, token: string): Promise<MCPClient>` (de `@ai-sdk/mcp`); `toolPrefix(slug: string | null): string` → `android_<slug>_` ou `android_`; `WORKER_TOOL_SUFFIXES: readonly string[]` (11); `pickWorkerTools(all: ToolSet, slug: string | null): ToolSet`; `missingWorkerTools(all: ToolSet, slug: string | null): readonly string[]`.

- [ ] **Step 1: Testes (falham)**

`daemon/test/tools.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { missingWorkerTools, pickWorkerTools, toolPrefix, WORKER_TOOL_SUFFIXES } from '../src/worker/tools.js';

const fakeSet = (names: string[]) => Object.fromEntries(names.map((n) => [n, { description: n, inputSchema: {} }])) as never;

describe('subset de tools do worker', () => {
  it('prefixo depende do slug', () => {
    expect(toolPrefix(null)).toBe('android_');
    expect(toolPrefix('conta1')).toBe('android_conta1_');
  });
  it('seleciona exatamente as 11 do workload e ignora o resto', () => {
    const all = fakeSet(['android_conta1_tap_node', 'android_conta1_get_screen_state', 'android_conta1_camera_capture', 'android_conta1_open_app']);
    const picked = pickWorkerTools(all, 'conta1');
    expect(Object.keys(picked).sort()).toEqual(['android_conta1_get_screen_state', 'android_conta1_open_app', 'android_conta1_tap_node']);
  });
  it('lista as tools que faltam (sonda: presença, nunca contagem)', () => {
    const all = fakeSet(WORKER_TOOL_SUFFIXES.filter((s) => s !== 'press_back').map((s) => `android_${s}`));
    expect(missingWorkerTools(all, null)).toEqual(['android_press_back']);
  });
});
```

`daemon/test/mcp.test.ts` — servidor MCP falso mínimo em `node:http` (initialize + tools/list) para provar header e transporte:

```ts
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectMcp } from '../src/device/mcp.js';

let server: http.Server; let url = ''; const seenAuth: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seenAuth.push(String(req.headers.authorization));
      const msg = JSON.parse(body || '{}') as { id?: number; method?: string };
      const reply = (result: unknown) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })); };
      if (msg.method === 'initialize') return reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '0' } });
      if (msg.method === 'tools/list') return reply({ tools: [{ name: 'android_get_screen_state', description: 'x', inputSchema: { type: 'object', properties: {} } }] });
      res.statusCode = 202; res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`;
});
afterAll(() => server.close());

describe('connectMcp', () => {
  it('envia bearer e lista tools via Streamable HTTP', async () => {
    const client = await connectMcp(url, 'segredo');
    const tools = await client.tools();
    expect(Object.keys(tools)).toContain('android_get_screen_state');
    expect(seenAuth.every((a) => a === 'Bearer segredo')).toBe(true);
    await client.close();
  });
});

describe.skipIf(!process.env.ENXAME_INTEGRATION)('MCP real', () => {
  it('lista 57 tools do device em 127.0.0.1:8080', async () => {
    const token = process.env.ENXAME_MCP_TOKEN ?? '';
    const client = await connectMcp('http://127.0.0.1:8080/mcp', token);
    expect(Object.keys(await client.tools()).length).toBeGreaterThanOrEqual(50);
    await client.close();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --project daemon daemon/test/tools.test.ts daemon/test/mcp.test.ts`
Expected: FAIL — módulos inexistentes

- [ ] **Step 3: Implementar**

`daemon/src/device/mcp.ts`:

```ts
import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';

/** Cliente MCP Streamable HTTP com bearer por identidade. `client.tools()` devolve um ToolSet do AI SDK. */
export async function connectMcp(url: string, token: string): Promise<MCPClient> {
  return createMCPClient({
    transport: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } },
    onUncaughtError: (e) => console.error('[mcp] erro não tratado', e),
  });
}
```

`daemon/src/worker/tools.ts`:

```ts
import type { ToolSet } from 'ai';

/** As 11 tools do fluxo de comentários (spec §4.3, subset −78%). Nomes sem prefixo. */
export const WORKER_TOOL_SUFFIXES = [
  'get_screen_state', 'get_node_details', 'find_nodes', 'click_node', 'tap_node', 'scroll', 'scroll_to_node',
  'wait_for_node', 'type_append_text', 'press_back', 'open_app',
] as const;

export function toolPrefix(slug: string | null): string {
  return slug ? `android_${slug}_` : 'android_';
}

export function pickWorkerTools(all: ToolSet, slug: string | null): ToolSet {
  const prefix = toolPrefix(slug);
  const wanted = new Set(WORKER_TOOL_SUFFIXES.map((s) => prefix + s));
  return Object.fromEntries(Object.entries(all).filter(([name]) => wanted.has(name)));
}

export function missingWorkerTools(all: ToolSet, slug: string | null): readonly string[] {
  const prefix = toolPrefix(slug);
  return WORKER_TOOL_SUFFIXES.map((s) => prefix + s).filter((name) => !(name in all));
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run --project daemon daemon/test/tools.test.ts daemon/test/mcp.test.ts`
Expected: PASS (4 tests; o real fica skipped sem `ENXAME_INTEGRATION`)

- [ ] **Step 5: Commit**

```bash
git add daemon/src/device/mcp.ts daemon/src/worker/tools.ts daemon/test/tools.test.ts daemon/test/mcp.test.ts
git commit -m "feat(daemon): cliente MCP com bearer e subset de 11 tools por sufixo"
```

---

### Task 5: Sonda de prontidão de 5 sinais

**Files:**
- Create: `daemon/src/device/probe.ts`
- Test: `daemon/test/probe.test.ts`

**Interfaces:**
- Consumes: `Adb` (Task 3), `connectMcp`/`missingWorkerTools` (Task 4), `IdentityRow` (Task 1).
- Produces: `probeIdentity(id: IdentityRow, deps: { adb: Adb; mcp?: (url, token) => Promise<{ tools(): Promise<ToolSet>; close(): Promise<void> }> }): Promise<ProbeResult>`; `type ProbeResult = { ready: boolean; signals: { bootCompleted; accessibility; mcpInitialize; toolsPresent; versionMatch }: Record<..., boolean>; details: readonly string[]; failureClass: 'infra' | 'version' | null }`.

- [ ] **Step 1: Teste (falha)**

`daemon/test/probe.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Adb } from '../src/device/adb.js';
import { AdbError } from '../src/device/adb.js';
import { probeIdentity } from '../src/device/probe.js';
import { WORKER_TOOL_SUFFIXES } from '../src/worker/tools.js';

const identity = {
  id: 'conta1', name: 'conta1', handle: '@a', avdName: 'x', serial: 'emulator-5554', consolePort: 5554, mcpHostPort: 8080,
  mcpToken: 't', deviceSlug: 'conta1', appPackage: 'com.instagram.android', appVersionName: '448.0.0.52.84', state: 'logged-in' as const,
};
const okAdb = (over: Partial<Adb> = {}): Adb => ({
  devices: async () => ['emulator-5554'],
  getprop: async () => '1',
  settingsGetSecure: async () => 'com.danielealbano.androidremotecontrolmcp.gms.debug/com.danielealbano.androidremotecontrolmcp.services.accessibility.McpAccessibilityService',
  versionName: async () => '448.0.0.52.84',
  forward: async () => {}, broadcastConfigure: async () => {}, startTrampoline: async () => {},
  ...over,
});
const okMcp = async () => ({
  tools: async () => Object.fromEntries(WORKER_TOOL_SUFFIXES.map((s) => [`android_conta1_${s}`, {}])) as never,
  close: async () => {},
});

describe('probeIdentity', () => {
  it('5 sinais verdes → ready', async () => {
    const r = await probeIdentity(identity, { adb: okAdb(), mcp: okMcp });
    expect(r.ready).toBe(true);
    expect(Object.values(r.signals).every(Boolean)).toBe(true);
  });
  it('versionName diferente → não pronto, classe version, os outros sinais ainda avaliados', async () => {
    const r = await probeIdentity(identity, { adb: okAdb({ versionName: async () => '449.0.0.1.1' }), mcp: okMcp });
    expect(r.ready).toBe(false);
    expect(r.signals.versionMatch).toBe(false);
    expect(r.failureClass).toBe('version');
    expect(r.details.join(' ')).toContain('449.0.0.1.1');
  });
  it('tool faltando → toolsPresent falso, mesmo com 56 outras', async () => {
    const mcp = async () => ({ tools: async () => ({ android_conta1_get_screen_state: {} }) as never, close: async () => {} });
    const r = await probeIdentity(identity, { adb: okAdb(), mcp });
    expect(r.signals.toolsPresent).toBe(false);
    expect(r.details.some((d) => d.includes('android_conta1_press_back'))).toBe(true);
  });
  it('device sumiu → tudo falso, classe infra, sem lançar', async () => {
    const adb = okAdb({ getprop: async () => { throw new AdbError('device-missing', "device 'emulator-5554' not found"); } });
    const r = await probeIdentity(identity, { adb, mcp: okMcp });
    expect(r.ready).toBe(false);
    expect(r.failureClass).toBe('infra');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --project daemon daemon/test/probe.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar**

`daemon/src/device/probe.ts`:

```ts
import type { ToolSet } from 'ai';
import type { IdentityRow } from '../db/identities.js';
import { missingWorkerTools } from '../worker/tools.js';
import { AdbError, type Adb } from './adb.js';
import { connectMcp } from './mcp.js';

export interface ProbeSignals {
  readonly bootCompleted: boolean; readonly accessibility: boolean; readonly mcpInitialize: boolean;
  readonly toolsPresent: boolean; readonly versionMatch: boolean;
}
export interface ProbeResult {
  readonly ready: boolean; readonly signals: ProbeSignals; readonly details: readonly string[];
  readonly failureClass: 'infra' | 'version' | null;
}
type McpFactory = (url: string, token: string) => Promise<{ tools(): Promise<ToolSet>; close(): Promise<void> }>;

const ACCESSIBILITY_SERVICE = 'services.accessibility.McpAccessibilityService';

async function mcpSignals(id: IdentityRow, mcp: McpFactory): Promise<{ init: boolean; present: boolean; detail: string | null }> {
  try {
    const client = await mcp(`http://127.0.0.1:${id.mcpHostPort}/mcp`, id.mcpToken);
    try {
      const missing = missingWorkerTools(await client.tools(), id.deviceSlug || null);
      return { init: true, present: missing.length === 0, detail: missing.length ? `tools ausentes: ${missing.join(', ')}` : null };
    } finally { await client.close(); }
  } catch (e) {
    return { init: false, present: false, detail: `MCP: ${(e as Error).message}` };
  }
}

export async function probeIdentity(id: IdentityRow, deps: { adb: Adb; mcp?: McpFactory }): Promise<ProbeResult> {
  const mcp = deps.mcp ?? connectMcp;
  const details: string[] = [];
  let infra = false;
  const safe = async <T,>(f: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await f(); } catch (e) { infra = infra || (e instanceof AdbError && e.kind === 'device-missing'); details.push((e as Error).message); return fallback; }
  };
  const boot = (await safe(() => deps.adb.getprop(id.serial, 'sys.boot_completed'), '')) === '1';
  const acc = (await safe(() => deps.adb.settingsGetSecure(id.serial, 'enabled_accessibility_services'), '')).includes(ACCESSIBILITY_SERVICE);
  const version = await safe(() => deps.adb.versionName(id.serial, id.appPackage), null);
  const versionMatch = version === id.appVersionName;
  if (!versionMatch) details.push(`versionName ${version ?? 'desconhecido'} ≠ ${id.appVersionName} registrado`);
  const m = boot ? await mcpSignals(id, mcp) : { init: false, present: false, detail: 'boot incompleto' };
  if (m.detail) details.push(m.detail);
  const signals: ProbeSignals = { bootCompleted: boot, accessibility: acc, mcpInitialize: m.init, toolsPresent: m.present, versionMatch };
  const ready = Object.values(signals).every(Boolean);
  const failureClass = ready ? null : infra || !boot || !m.init ? 'infra' : !versionMatch ? 'version' : 'infra';
  return { ready, signals, details, failureClass };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run --project daemon daemon/test/probe.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add daemon/src/device/probe.ts daemon/test/probe.test.ts
git commit -m "feat(daemon): sonda de prontidão de 5 sinais com classe de falha"
```

---

### Task 6: Lease de portas e ciclo de vida da identidade

**Files:**
- Create: `daemon/src/fleet/ports.ts`, `daemon/src/fleet/identity.ts`
- Test: `daemon/test/ports.test.ts`, `daemon/test/identity.test.ts`

**Interfaces:**
- Consumes: `openDb`, `IdentityRow`, `upsertIdentity`, `setIdentityState` (Task 1); `Adb` (Task 3); `probeIdentity` (Task 5).
- Produces: `isPortFree(port: number): Promise<boolean>`; `leasePorts(db, opts?: { consoleFrom?; consoleMax?; mcpHostFrom? }): Promise<{ consolePort: number; mcpHostPort: number }>` (pula portas em uso no banco **e** no SO); `ensureIdentityReady(db, id: IdentityRow, deps: { adb: Adb; probe?: typeof probeIdentity }): Promise<ProbeResult>` (refaz `adb forward`, aplica slug/token por broadcast se ainda não aplicados, roda a sonda, atualiza `state`).

- [ ] **Step 1: Testes (falham)**

`daemon/test/ports.test.ts`:

```ts
import net from 'node:net';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { upsertIdentity } from '../src/db/identities.js';
import { isPortFree, leasePorts } from '../src/fleet/ports.js';

const hold = (port: number) => new Promise<net.Server>((r) => { const s = net.createServer(); s.listen(port, '127.0.0.1', () => r(s)); });

describe('lease de portas', () => {
  it('detecta porta ocupada no SO', async () => {
    const s = await hold(0); const port = (s.address() as net.AddressInfo).port;
    expect(await isPortFree(port)).toBe(false);
    s.close();
  });
  it('pula porta presa e porta já leased no banco', async () => {
    const db = openDb(':memory:');
    upsertIdentity(db, { id: 'a', name: 'a', handle: '@a', avdName: 'x', serial: 'emulator-5554', consolePort: 5554, mcpHostPort: 8080, mcpToken: 't', deviceSlug: 'a', appPackage: 'p', appVersionName: '1', state: 'idle' });
    const s = await hold(5556);
    const lease = await leasePorts(db, { consoleFrom: 5554, consoleMax: 5584, mcpHostFrom: 8080 });
    expect(lease.consolePort).toBe(5558);
    expect(lease.mcpHostPort).toBe(8081);
    s.close();
  });
  it('estoura o teto de 16 slots com erro explícito', async () => {
    const db = openDb(':memory:');
    for (let i = 0; i < 16; i++) upsertIdentity(db, { id: `i${i}`, name: `i${i}`, handle: '@', avdName: 'x', serial: `emulator-${5554 + i * 2}`, consolePort: 5554 + i * 2, mcpHostPort: 8080 + i, mcpToken: 't', deviceSlug: `i${i}`, appPackage: 'p', appVersionName: '1', state: 'idle' });
    await expect(leasePorts(db, { consoleFrom: 5554, consoleMax: 5584, mcpHostFrom: 8080 })).rejects.toThrow(/16 slots/);
  });
});
```

`daemon/test/identity.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Adb } from '../src/device/adb.js';
import { openDb } from '../src/db/open.js';
import { getIdentity, upsertIdentity } from '../src/db/identities.js';
import { ensureIdentityReady } from '../src/fleet/identity.js';

const row = { id: 'conta1', name: 'conta1', handle: '@a', avdName: 'x', serial: 'emulator-5554', consolePort: 5554, mcpHostPort: 8080, mcpToken: 'tok', deviceSlug: 'conta1', appPackage: 'com.instagram.android', appVersionName: '448.0.0.52.84', state: 'logged-in' as const };
const adbSpy = () => {
  const calls: string[] = [];
  const adb: Adb = {
    devices: async () => ['emulator-5554'], getprop: async () => '1', settingsGetSecure: async () => '', versionName: async () => '448.0.0.52.84',
    forward: async (s, h, d) => { calls.push(`forward ${s} ${h} ${d}`); },
    broadcastConfigure: async (_s, e) => { calls.push(`configure ${Object.keys(e).sort().join(',')}`); },
    startTrampoline: async (_s, a) => { calls.push(`trampoline ${a}`); },
  };
  return { adb, calls };
};
const readyProbe = async () => ({ ready: true, signals: { bootCompleted: true, accessibility: true, mcpInitialize: true, toolsPresent: true, versionMatch: true }, details: [], failureClass: null });
const versionProbe = async () => ({ ready: false, signals: { bootCompleted: true, accessibility: true, mcpInitialize: true, toolsPresent: true, versionMatch: false }, details: ['versionName 449 ≠ 448'], failureClass: 'version' as const });

describe('ensureIdentityReady', () => {
  it('refaz forward, aplica slug e token por broadcast e marca idle quando pronta', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const { adb, calls } = adbSpy();
    const r = await ensureIdentityReady(db, row, { adb, probe: readyProbe });
    expect(r.ready).toBe(true);
    expect(calls).toContain('forward emulator-5554 8080 8080');
    expect(calls).toContain('configure bearer_token,bearer_token_enabled,device_slug');
    expect(getIdentity(db, 'conta1')?.state).toBe('idle');
  });
  it('versão divergente → offline com last_error, sem lançar', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const r = await ensureIdentityReady(db, row, { adb: adbSpy().adb, probe: versionProbe });
    expect(r.ready).toBe(false);
    const got = getIdentity(db, 'conta1');
    expect(got?.state).toBe('offline');
    expect(got?.lastError).toContain('449');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --project daemon daemon/test/ports.test.ts daemon/test/identity.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar**

`daemon/src/fleet/ports.ts`:

```ts
import net from 'node:net';
import type { DatabaseSync } from 'node:sqlite';
import { CONFIG } from '../config.js';

export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}

function usedPorts(db: DatabaseSync): { console: ReadonlySet<number>; mcp: ReadonlySet<number> } {
  const rows = db.prepare('select console_port, mcp_host_port from identity').all() as { console_port: number; mcp_host_port: number }[];
  return { console: new Set(rows.map((r) => r.console_port)), mcp: new Set(rows.map((r) => r.mcp_host_port)) };
}

/** Lease real: pula portas registradas E portas presas no SO (TIME_WAIT, qemu zumbi). Teto: 16 slots (adb varre 5555–5585). */
export async function leasePorts(
  db: DatabaseSync,
  opts: { consoleFrom?: number; consoleMax?: number; mcpHostFrom?: number } = {},
): Promise<{ consolePort: number; mcpHostPort: number }> {
  const from = opts.consoleFrom ?? CONFIG.ports.consoleFrom;
  const max = opts.consoleMax ?? CONFIG.ports.consoleMax;
  const used = usedPorts(db);
  let consolePort = -1;
  for (let p = from; p <= max; p += 2) {
    if (used.console.has(p)) continue;
    if ((await isPortFree(p)) && (await isPortFree(p + 1))) { consolePort = p; break; }
  }
  if (consolePort < 0) throw new Error(`sem porta de console livre: os 16 slots (${from}–${max}) estão ocupados ou presos`);
  let mcpHostPort = opts.mcpHostFrom ?? CONFIG.ports.mcpHostFrom;
  while (used.mcp.has(mcpHostPort) || !(await isPortFree(mcpHostPort))) mcpHostPort += 1;
  return { consolePort, mcpHostPort };
}
```

`daemon/src/fleet/identity.ts`:

```ts
import type { DatabaseSync } from 'node:sqlite';
import type { Adb } from '../device/adb.js';
import { probeIdentity, type ProbeResult } from '../device/probe.js';
import { setIdentityState, type IdentityRow } from '../db/identities.js';

const MCP_DEVICE_PORT = 8080;

/** Garante forward, slug e token, roda a sonda e persiste o estado resultante. Nunca lança por falha de sonda. */
export async function ensureIdentityReady(
  db: DatabaseSync, id: IdentityRow,
  deps: { adb: Adb; probe?: typeof probeIdentity },
): Promise<ProbeResult> {
  const probe = deps.probe ?? probeIdentity;
  await deps.adb.forward(id.serial, id.mcpHostPort, MCP_DEVICE_PORT);
  await deps.adb.broadcastConfigure(id.serial, { bearer_token: id.mcpToken, bearer_token_enabled: true, device_slug: id.deviceSlug });
  const result = await probe(id, { adb: deps.adb });
  if (result.ready) {
    setIdentityState(db, id.id, 'idle', { lastError: null });
  } else {
    setIdentityState(db, id.id, 'offline', { lastError: result.details.join(' · ') || `sonda falhou (${result.failureClass})` });
  }
  return result;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run --project daemon daemon/test/ports.test.ts daemon/test/identity.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add daemon/src/fleet daemon/test/ports.test.ts daemon/test/identity.test.ts
git commit -m "feat(daemon): lease de portas com verificação de socket e prontidão da identidade"
```

---

### Task 7: Gate determinístico e poda de histórico

**Files:**
- Create: `daemon/src/worker/gate.ts`, `daemon/src/worker/prune.ts`
- Test: `daemon/test/gate.test.ts`, `daemon/test/prune.test.ts`

**Interfaces:**
- Consumes: `parseScreen`, `nodeById` (Task 2); `toolPrefix` (Task 4).
- Produces: `IRREVERSIBLE_LABEL: RegExp`; `decideNodeAction(nodeId: string, screen: ScreenState | null): ToolApprovalStatus`; `buildToolApproval(slug: string | null, lastScreen: () => ScreenState | null, mode: 'read-only'): Record<string, (input: unknown) => ToolApprovalStatus>`; `isScreenTool(name: string): boolean`; `pruneScreens(messages: readonly ModelMessage[], keep: number): ModelMessage[]`; `PRUNED_PLACEHOLDER: string`.

- [ ] **Step 1: Testes (falham)**

`daemon/test/gate.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseScreen } from '../src/screen/parse.js';
import { buildToolApproval, decideNodeAction } from '../src/worker/gate.js';

const S = JSON.parse(readFileSync(new URL('./fixtures/screens.json', import.meta.url), 'utf8')) as Record<string, string>;
const play = parseScreen(S.play_store); // tem "I'm in!" e "Not now"
const withSend = parseScreen(S.launcher + '\nnode_ff01\tButton\tEnviar\t-\t-\t0,0,10,10\ton,clk,ena\n');

describe('gate determinístico', () => {
  it('nega toque em nó com rótulo irreversível e explica', () => {
    const d = decideNodeAction('node_ff01', withSend);
    expect(d).toMatchObject({ type: 'denied' });
    expect(String((d as { reason?: string }).reason)).toMatch(/Enviar/);
  });
  it('aprova toque em nó comum', () => {
    expect(decideNodeAction('node_bec469ea', withSend)).toBe('approved'); // ícone do Instagram
  });
  it('sem tela conhecida, nega: não se toca no que não se leu', () => {
    expect(decideNodeAction('node_x', null)).toMatchObject({ type: 'denied' });
  });
  it('buildToolApproval cobre click/tap com o prefixo do slug e nega digitação em modo somente-leitura', () => {
    let screen = play;
    const approvals = buildToolApproval('conta1', () => screen, 'read-only');
    expect(Object.keys(approvals).sort()).toEqual(['android_conta1_click_node', 'android_conta1_tap_node', 'android_conta1_type_append_text']);
    expect(approvals.android_conta1_type_append_text({ node_id: 'n', text: 'oi' })).toMatchObject({ type: 'denied' });
    const notNow = play.windows.flatMap((w) => w.nodes).find((n) => n.text === 'Not now')!;
    expect(approvals.android_conta1_click_node({ node_id: notNow.id })).toBe('approved');
    screen = withSend;
    expect(approvals.android_conta1_tap_node({ node_id: 'node_ff01' })).toMatchObject({ type: 'denied' });
  });
});
```

`daemon/test/prune.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import { isScreenTool, PRUNED_PLACEHOLDER, pruneScreens } from '../src/worker/prune.js';

const screenResult = (id: string, text: string): ModelMessage => ({
  role: 'tool', content: [{ type: 'tool-result', toolCallId: id, toolName: 'android_conta1_get_screen_state', output: { type: 'text', value: text } }],
});
const otherResult = (id: string): ModelMessage => ({
  role: 'tool', content: [{ type: 'tool-result', toolCallId: id, toolName: 'android_conta1_click_node', output: { type: 'text', value: 'Click performed' } }],
});

describe('pruneScreens', () => {
  it('mantém só os N últimos screen states e substitui os antigos pelo placeholder', () => {
    const msgs: ModelMessage[] = [
      { role: 'user', content: 'objetivo' }, screenResult('a', 'tela 1'), otherResult('b'), screenResult('c', 'tela 2'), screenResult('d', 'tela 3'),
    ];
    const out = pruneScreens(msgs, 2);
    const texts = out.filter((m) => m.role === 'tool').map((m) => (m.content[0] as { output: { value: string } }).output.value);
    expect(texts).toEqual([PRUNED_PLACEHOLDER, 'Click performed', 'tela 2', 'tela 3']);
    expect((msgs[1].content[0] as { output: { value: string } }).output.value).toBe('tela 1'); // entrada não mutada
  });
  it('não toca em nada quando há N ou menos', () => {
    const msgs: ModelMessage[] = [screenResult('a', 'x'), screenResult('b', 'y')];
    expect(pruneScreens(msgs, 2)).toEqual(msgs);
  });
  it('isScreenTool reconhece qualquer prefixo de slug', () => {
    expect(isScreenTool('android_get_screen_state')).toBe(true);
    expect(isScreenTool('android_conta3_get_screen_state')).toBe(true);
    expect(isScreenTool('android_conta3_get_node_details')).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --project daemon daemon/test/gate.test.ts daemon/test/prune.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar**

`daemon/src/worker/gate.ts`:

```ts
import type { ToolApprovalStatus } from 'ai';
import { nodeById } from '../screen/checks.js';
import type { ScreenState } from '../screen/parse.js';
import { toolPrefix } from './tools.js';

/** Rótulos que publicam, enviam, pagam ou comprometem — irreversíveis para terceiros. */
export const IRREVERSIBLE_LABEL =
  /^(enviar|send|post|publicar|postar|responder|reply|compartilhar|share|pagar|pay|comprar|buy|confirmar|confirm|seguir|follow|excluir|delete|apagar|remover|remove|bloquear|block|denunciar|report)$/i;

const deny = (reason: string): ToolApprovalStatus => ({ type: 'denied', reason: `GATE: ${reason}` });

/** Decide um toque/click por nó, olhando a última tela lida. Sem tela, nega: não se toca no que não se leu. */
export function decideNodeAction(nodeId: string, screen: ScreenState | null): ToolApprovalStatus {
  if (!screen) return deny('nenhum screen state lido antes de agir');
  const n = nodeById(screen, nodeId);
  if (!n) return deny(`nó ${nodeId} não está na última tela lida; leia a tela de novo`);
  const label = (n.text || n.desc).trim();
  if (IRREVERSIBLE_LABEL.test(label)) return deny(`toque em "${label}" é irreversível e este incremento é somente-leitura`);
  return 'approved';
}

type Approval = (input: unknown) => ToolApprovalStatus;

export function buildToolApproval(slug: string | null, lastScreen: () => ScreenState | null, mode: 'read-only'): Record<string, Approval> {
  const p = toolPrefix(slug);
  const byNode: Approval = (input) => decideNodeAction(String((input as { node_id?: unknown })?.node_id ?? ''), lastScreen());
  const noTyping: Approval = () => deny(`digitar em campo do app não é permitido em modo ${mode}; registre rascunhos no ledger`);
  return { [`${p}click_node`]: byNode, [`${p}tap_node`]: byNode, [`${p}type_append_text`]: noTyping };
}
```

`daemon/src/worker/prune.ts`:

```ts
import type { ModelMessage } from 'ai';

export const PRUNED_PLACEHOLDER = '[estado de tela podado — chame get_screen_state para ver a tela atual]';

export function isScreenTool(name: string): boolean {
  return /^android_(?:[a-z0-9]+_)?get_screen_state$/.test(name);
}

type ToolPart = { type: string; toolCallId?: string; toolName?: string; output?: { type: string; value?: unknown } };

/** Mantém os `keep` últimos resultados de get_screen_state; os anteriores viram placeholder. Nunca muta a entrada. */
export function pruneScreens(messages: readonly ModelMessage[], keep: number): ModelMessage[] {
  const screenIds: string[] = [];
  for (const m of messages) {
    if (m.role !== 'tool') continue;
    for (const part of m.content as readonly ToolPart[]) {
      if (part.type === 'tool-result' && part.toolName && isScreenTool(part.toolName) && part.toolCallId) screenIds.push(part.toolCallId);
    }
  }
  const stale = new Set(screenIds.slice(0, Math.max(0, screenIds.length - keep)));
  if (stale.size === 0) return [...messages];
  return messages.map((m) => {
    if (m.role !== 'tool') return m;
    const content = (m.content as readonly ToolPart[]).map((part) =>
      part.type === 'tool-result' && part.toolCallId && stale.has(part.toolCallId)
        ? { ...part, output: { type: 'text', value: PRUNED_PLACEHOLDER } }
        : part,
    );
    return { ...m, content } as ModelMessage;
  });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run --project daemon daemon/test/gate.test.ts daemon/test/prune.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add daemon/src/worker/gate.ts daemon/src/worker/prune.ts daemon/test/gate.test.ts daemon/test/prune.test.ts
git commit -m "feat(worker): gate determinístico por rótulo de nó e poda de screen states"
```

---

### Task 8: Registro de passos, ledger, prompt e o loop do worker

**Files:**
- Create: `daemon/src/db/tasks.ts`, `daemon/src/worker/record.ts`, `daemon/src/worker/prompt.ts`, `daemon/src/worker/run.ts`
- Test: `daemon/test/record.test.ts`, `daemon/test/run.test.ts`

**Interfaces:**
- Consumes: `openDb`, `setIdentityState`, `IdentityRow` (Task 1); `parseScreen`, `detectPlatformBlock` (Task 2); `connectMcp`, `pickWorkerTools`, `toolPrefix` (Task 4); `buildToolApproval`, `pruneScreens`, `isScreenTool` (Task 7); `CONFIG`.
- Produces: `createGoalAndTask(db, identityId, text): { goalId; taskId }`; `writeIntent(db, taskId, idx, tool, args, idempotencyKey): number` (id do step); `finishStep(db, stepId, patch)`; `ledgerHas(db, identityId, key): boolean`; `ledgerPut(db, identityId, key, kind, note)`; `recordStep(db, taskId, step: StepLike, pricing): { costUsd: number }`; `readUsage(u): { inputTokens; outputTokens; cacheReadTokens }`; `SYSTEM_PROMPT: string`; `taskInstruction(goalText): string`; `runTask(opts: RunTaskOpts): Promise<RunTaskResult>`; `type RunTaskResult = { taskId; outcome: 'done'|'budget'|'killed'|'platform-block'|'infra'|'failed'; costUsd; usage; platformBlock: string | null; summary: string }`.

- [ ] **Step 1: Testes (falham)**

`daemon/test/record.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { upsertIdentity } from '../src/db/identities.js';
import { createGoalAndTask, finishStep, ledgerHas, ledgerPut, writeIntent } from '../src/db/tasks.js';
import { readUsage, recordStep } from '../src/worker/record.js';

const row = { id: 'conta1', name: 'conta1', handle: '@a', avdName: 'x', serial: 's', consolePort: 5554, mcpHostPort: 8080, mcpToken: 't', deviceSlug: 'conta1', appPackage: 'p', appVersionName: '1', state: 'idle' as const };
const PRICING = { inputPerM: 1, outputPerM: 5, cacheReadPerM: 0.1 };

describe('write-ahead e ledger', () => {
  it('writeIntent grava antes; finishStep completa; idempotency_key é único por (tarefa, chave)', () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const { taskId } = createGoalAndTask(db, 'conta1', 'objetivo');
    const id = writeIntent(db, taskId, 1, 'android_conta1_click_node', { node_id: 'n1' }, 'conta1:click:n1');
    const pending = db.prepare('select finished_at, intent_written_at from step where id=?').get(id) as { finished_at: string | null; intent_written_at: string };
    expect(pending.finished_at).toBeNull(); expect(pending.intent_written_at).toBeTruthy();
    finishStep(db, id, { resultExcerpt: 'Click performed', latencyMs: 120 });
    expect((db.prepare('select finished_at from step where id=?').get(id) as { finished_at: string }).finished_at).toBeTruthy();
  });
  it('ledger: put é idempotente e has responde', () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    expect(ledgerHas(db, 'conta1', 'comment:jufs:abc')).toBe(false);
    ledgerPut(db, 'conta1', 'comment:jufs:abc', 'comment', 'rascunho: obrigada!');
    ledgerPut(db, 'conta1', 'comment:jufs:abc', 'comment', 'de novo');
    expect(ledgerHas(db, 'conta1', 'comment:jufs:abc')).toBe(true);
    expect((db.prepare('select count(*) as n from ledger').get() as { n: number }).n).toBe(1);
  });
});

describe('recordStep', () => {
  it('grava tokens por passo, soma custo na tarefa e marca GATE quando negado', () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const { taskId } = createGoalAndTask(db, 'conta1', 'objetivo');
    const step = {
      stepNumber: 0, text: '',
      toolCalls: [{ toolCallId: 'c1', toolName: 'android_conta1_tap_node', input: { node_id: 'n9' } }],
      toolResults: [{ toolCallId: 'c1', toolName: 'android_conta1_tap_node', output: { type: 'execution-denied', reason: 'GATE: irreversível' } }],
      usage: { inputTokens: 6000, outputTokens: 80, inputTokenDetails: { cacheReadTokens: 5000 } },
    };
    const { costUsd } = recordStep(db, taskId, step, PRICING);
    expect(costUsd).toBeCloseTo((1000 * 1 + 5000 * 0.1 + 80 * 5) / 1_000_000, 8);
    const s = db.prepare('select tool, result_excerpt, input_tokens, cache_read_tokens from step where task_id=?').get(taskId) as Record<string, unknown>;
    expect(s.tool).toBe('android_conta1_tap_node'); expect(String(s.result_excerpt)).toMatch(/^GATE/); expect(s.cache_read_tokens).toBe(5000);
    expect((db.prepare('select cost_usd from task where id=?').get(taskId) as { cost_usd: number }).cost_usd).toBeCloseTo(costUsd, 8);
  });
  it('readUsage tolera campos ausentes', () => {
    expect(readUsage({})).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 });
  });
  it('tool alucinada / erro de execução vira linha com error e excerpt ERRO, sem lançar', () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const { taskId } = createGoalAndTask(db, 'conta1', 'objetivo');
    const step = {
      stepNumber: 1, text: '',
      toolCalls: [{ toolCallId: 'c2', toolName: 'android_conta1_launch_app', input: {} }],
      toolResults: [{ toolCallId: 'c2', toolName: 'android_conta1_launch_app', output: { type: 'error-text', value: 'NoSuchToolError: android_conta1_launch_app' } }],
      usage: { inputTokens: 10, outputTokens: 2 },
    };
    expect(() => recordStep(db, taskId, step, PRICING)).not.toThrow();
    const s = db.prepare('select result_excerpt, error from step where task_id=?').get(taskId) as { result_excerpt: string; error: string | null };
    expect(s.result_excerpt).toMatch(/^ERRO/); expect(s.error).toMatch(/NoSuchToolError/);
  });
});
```

`daemon/test/run.test.ts` — o loop com modelo e MCP falsos, exercitando as classes de erro do Review Focus:

```ts
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { getIdentity, upsertIdentity } from '../src/db/identities.js';
import { runTask, type RunTaskDeps } from '../src/worker/run.js';

const row = { id: 'conta1', name: 'conta1', handle: '@a', avdName: 'x', serial: 's', consolePort: 5554, mcpHostPort: 8080, mcpToken: 't', deviceSlug: 'conta1', appPackage: 'com.instagram.android', appVersionName: '1', state: 'idle' as const };
const CK = 'screen:1080x2400 density:420 orientation:portrait\n--- window:1 type:APPLICATION pkg:com.instagram.android title:Instagram layer:0 focused:true ---\nnode_id\tclass\ttext\tdesc\tres_id\tbounds\tflags\nnode_a1\tTextView\tConfirme que é você\t-\t-\t0,0,10,10\ton,ena\n';

/** generateText falso: chama a tool de tela uma vez e devolve texto. Suficiente para testar o que é nosso. */
const fakeGenerate = (screenText: string): RunTaskDeps['generate'] => async (opts) => {
  const tool = opts.tools['android_conta1_get_screen_state'] as { execute: (i: unknown, o: unknown) => Promise<unknown> };
  const out = await tool.execute({}, { toolCallId: 'x', messages: [] });
  await opts.onStepFinish?.({ stepNumber: 0, text: '', toolCalls: [{ toolCallId: 'x', toolName: 'android_conta1_get_screen_state', input: {} }], toolResults: [{ toolCallId: 'x', toolName: 'android_conta1_get_screen_state', output: { type: 'text', value: String(out) } }], usage: { inputTokens: 100, outputTokens: 10 } } as never);
  return { text: 'resumo', totalUsage: { inputTokens: 100, outputTokens: 10 }, steps: [] } as never;
};
const fakeMcp = (screenText: string, fail?: 'unauthorized' | 'device-missing'): RunTaskDeps['connect'] => async () => ({
  tools: async () => ({
    android_conta1_get_screen_state: { description: 'x', inputSchema: {}, execute: async () => { if (fail === 'unauthorized') throw new Error('HTTP 401 Unauthorized'); if (fail === 'device-missing') throw new Error("adb: device 'emulator-5554' not found"); return screenText; } },
    android_conta1_click_node: { description: 'x', inputSchema: {}, execute: async () => 'ok' },
  }) as never,
  close: async () => {},
});

describe('runTask', () => {
  it('checkpoint na tela → platform-block, identidade needs-human, loop encerra', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const r = await runTask({ db, identity: row, goalText: 'g', apiKey: 'k', isKilled: () => false, onStep: () => {} }, { connect: fakeMcp(CK), generate: fakeGenerate(CK) });
    expect(r.outcome).toBe('platform-block'); expect(r.platformBlock).toMatch(/Confirme/);
    expect(getIdentity(db, 'conta1')?.state).toBe('needs-human');
  });
  it('401 do MCP → infra, identidade offline, sem retry', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const r = await runTask({ db, identity: row, goalText: 'g', apiKey: 'k', isKilled: () => false, onStep: () => {} }, { connect: fakeMcp('', 'unauthorized'), generate: fakeGenerate('') });
    expect(r.outcome).toBe('infra'); expect(getIdentity(db, 'conta1')?.state).toBe('offline');
    expect((db.prepare('select count(*) as n from step').get() as { n: number }).n).toBeLessThanOrEqual(1);
  });
  it('device sumiu → infra e tarefa volta para todo', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const r = await runTask({ db, identity: row, goalText: 'g', apiKey: 'k', isKilled: () => false, onStep: () => {} }, { connect: fakeMcp('', 'device-missing'), generate: fakeGenerate('') });
    expect(r.outcome).toBe('infra');
    expect((db.prepare('select state from task where id=?').get(r.taskId) as { state: string }).state).toBe('todo');
  });
  it('tela normal → done, identidade idle, passo gravado com tokens', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const normal = 'screen:1080x2400 density:420 orientation:portrait\n--- window:1 type:APPLICATION pkg:com.instagram.android title:Instagram layer:0 focused:true ---\nnode_id\tclass\ttext\tdesc\tres_id\tbounds\tflags\nnode_b1\tTextView\tFeed\t-\t-\t0,0,10,10\ton,ena\n';
    const r = await runTask({ db, identity: row, goalText: 'g', apiKey: 'k', isKilled: () => false, onStep: () => {} }, { connect: fakeMcp(normal), generate: fakeGenerate(normal) });
    expect(r.outcome).toBe('done'); expect(getIdentity(db, 'conta1')?.state).toBe('idle');
    expect((db.prepare('select input_tokens from step').get() as { input_tokens: number }).input_tokens).toBe(100);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --project daemon daemon/test/record.test.ts daemon/test/run.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar persistência de tarefas**

`daemon/src/db/tasks.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export function createGoalAndTask(db: DatabaseSync, identityId: string, text: string): { goalId: string; taskId: string } {
  const goalId = randomUUID(); const taskId = randomUUID();
  db.prepare("insert into goal (id, text, pattern, state) values (?, ?, 'fan-out', 'running')").run(goalId, text);
  db.prepare("insert into task (id, goal_id, identity_id, instruction, state, attempts) values (?, ?, ?, ?, 'running', 1)").run(taskId, goalId, identityId, text);
  return { goalId, taskId };
}

export function setTaskState(db: DatabaseSync, taskId: string, state: 'todo' | 'running' | 'done' | 'failed' | 'needs-human'): void {
  db.prepare("update task set state=?, finished_at=case when ? in ('done','failed','needs-human') then datetime('now') else finished_at end where id=?").run(state, state, taskId);
}

/** Intenção write-ahead: a linha existe ANTES da tool rodar (spec §4.3, recuperação de crash). */
export function writeIntent(db: DatabaseSync, taskId: string, idx: number, tool: string, args: unknown, idempotencyKey: string): number {
  const r = db.prepare("insert into step (task_id, idx, tool, args_json, idempotency_key, intent_written_at, started_at) values (?, ?, ?, ?, ?, datetime('now'), datetime('now'))")
    .run(taskId, idx, tool, JSON.stringify(args ?? null), idempotencyKey);
  return Number(r.lastInsertRowid);
}

export function finishStep(db: DatabaseSync, stepId: number, p: { resultExcerpt?: string; latencyMs?: number; error?: string; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number }): void {
  db.prepare(`update step set result_excerpt=coalesce(?, result_excerpt), latency_ms=coalesce(?, latency_ms), error=coalesce(?, error),
    input_tokens=coalesce(?, input_tokens), output_tokens=coalesce(?, output_tokens), cache_read_tokens=coalesce(?, cache_read_tokens), finished_at=datetime('now') where id=?`)
    .run(p.resultExcerpt ?? null, p.latencyMs ?? null, p.error ?? null, p.inputTokens ?? null, p.outputTokens ?? null, p.cacheReadTokens ?? null, stepId);
}

export function addTaskCost(db: DatabaseSync, taskId: string, usd: number): void {
  db.prepare('update task set cost_usd = cost_usd + ? where id=?').run(usd, taskId);
  db.prepare('update goal set cost_usd = cost_usd + ? where id = (select goal_id from task where id=?)').run(usd, taskId);
}

export function ledgerHas(db: DatabaseSync, identityId: string, key: string): boolean {
  return !!db.prepare('select 1 from ledger where identity_id=? and item_key=?').get(identityId, key);
}
export function ledgerPut(db: DatabaseSync, identityId: string, key: string, kind: string, note: string): void {
  db.prepare('insert or ignore into ledger (identity_id, item_key, kind, note) values (?, ?, ?, ?)').run(identityId, key, kind, note);
}
```

- [ ] **Step 4: Implementar registro de custo**

`daemon/src/worker/record.ts`:

```ts
import type { DatabaseSync } from 'node:sqlite';
import { addTaskCost, finishStep, writeIntent } from '../db/tasks.js';

export interface Pricing { readonly inputPerM: number; readonly outputPerM: number; readonly cacheReadPerM: number }
/** Preços por milhão de tokens. CONFIRMAR na tabela oficial antes de usar em relatório; o relatório também imprime tokens crus. */
export const HAIKU_PRICING: Pricing = { inputPerM: 1, outputPerM: 5, cacheReadPerM: 0.1 };

export interface UsageLike {
  readonly inputTokens?: number; readonly outputTokens?: number;
  readonly inputTokenDetails?: { readonly cacheReadTokens?: number };
  readonly cachedInputTokens?: number;
}
export interface StepLike {
  readonly stepNumber: number; readonly text: string;
  readonly toolCalls: readonly { toolCallId: string; toolName: string; input: unknown }[];
  readonly toolResults: readonly { toolCallId: string; toolName: string; output: { type: string; value?: unknown; reason?: string } }[];
  readonly usage: UsageLike;
}

export function readUsage(u: UsageLike): { inputTokens: number; outputTokens: number; cacheReadTokens: number } {
  return { inputTokens: u.inputTokens ?? 0, outputTokens: u.outputTokens ?? 0, cacheReadTokens: u.inputTokenDetails?.cacheReadTokens ?? u.cachedInputTokens ?? 0 };
}

export function costOf(u: UsageLike, p: Pricing): number {
  const { inputTokens, outputTokens, cacheReadTokens } = readUsage(u);
  return ((inputTokens - cacheReadTokens) * p.inputPerM + cacheReadTokens * p.cacheReadPerM + outputTokens * p.outputPerM) / 1_000_000;
}

function excerptOf(out: { type: string; value?: unknown; reason?: string }): { excerpt: string; error: string | null } {
  if (out.type === 'execution-denied') return { excerpt: `GATE ${out.reason ?? ''}`.trim(), error: null };
  const v = out.value;
  const s = (typeof v === 'string' ? v : JSON.stringify(v) ?? '').replace(/\s+/g, ' ');
  if (out.type === 'error-text' || out.type === 'error-json') return { excerpt: `ERRO ${s}`.slice(0, 300), error: s.slice(0, 500) };
  return { excerpt: s.slice(0, 300), error: null };
}

/** Um passo do modelo pode ter 0..n tool calls; cada uma vira uma linha de step com a mesma usage rateada no primeiro. */
export function recordStep(db: DatabaseSync, taskId: string, step: StepLike, pricing: Pricing): { costUsd: number } {
  const usage = readUsage(step.usage);
  const costUsd = costOf(step.usage, pricing);
  const calls = step.toolCalls.length ? step.toolCalls : [{ toolCallId: `s${step.stepNumber}`, toolName: '(texto)', input: null }];
  calls.forEach((c, i) => {
    const id = writeIntent(db, taskId, step.stepNumber * 100 + i, c.toolName, c.input, `${taskId}:${step.stepNumber}:${c.toolCallId}`);
    const res = step.toolResults.find((r) => r.toolCallId === c.toolCallId);
    const ex = res ? excerptOf(res.output) : { excerpt: step.text.slice(0, 300), error: null };
    finishStep(db, id, {
      resultExcerpt: ex.excerpt, error: ex.error ?? undefined,
      inputTokens: i === 0 ? usage.inputTokens : 0, outputTokens: i === 0 ? usage.outputTokens : 0, cacheReadTokens: i === 0 ? usage.cacheReadTokens : 0,
    });
  });
  addTaskCost(db, taskId, costUsd);
  return { costUsd };
}
```

- [ ] **Step 5: Prompt somente-leitura**

`daemon/src/worker/prompt.ts`:

```ts
export const SYSTEM_PROMPT = `Você opera UM celular Android por ferramentas. O app alvo é o Instagram, já logado.
Regras invioláveis:
1. Leia a tela com get_screen_state antes de qualquer ação, e de novo depois de cada ação.
2. Este turno é SOMENTE LEITURA: nunca toque em Enviar/Publicar/Postar/Responder/Compartilhar/Seguir/Pagar. Um gate vai negar; se negar, não insista.
3. Não digite em campos do app. Rascunhos vão para a ferramenta ledger_record.
4. Antes de tratar um comentário, chame ledger_record; se ela responder already=true, pule o item.
5. Se aparecer "Confirme que é você", captcha, ou pedido de código, pare imediatamente e diga o que viu.
6. Seja econômico: use find_nodes e get_node_details em vez de reler a tela inteira quando bastar.
Ao terminar, responda com um resumo curto: itens encontrados, itens já tratados, rascunhos propostos.`;

export function taskInstruction(goalText: string): string {
  return `Objetivo: ${goalText}
Passos esperados: abrir o Instagram (open_app com com.instagram.android), ir para a aba de atividade/notificações, localizar até 5 comentários recentes ainda sem resposta nas publicações desta conta, e para cada um chamar ledger_record com item_key "comment:<autor>:<8 primeiros chars do texto>", o autor, o trecho e um rascunho de resposta curta e cordial em português. Não envie nada.`;
}
```

- [ ] **Step 6: O loop**

`daemon/src/worker/run.ts`:

```ts
import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText, stepCountIs, tool, type ModelMessage, type StopCondition, type Tool, type ToolSet } from 'ai';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { CONFIG } from '../config.js';
import { setIdentityState, type IdentityRow } from '../db/identities.js';
import { createGoalAndTask, ledgerHas, ledgerPut, setTaskState } from '../db/tasks.js';
import { connectMcp } from '../device/mcp.js';
import { detectPlatformBlock } from '../screen/checks.js';
import { parseScreen, type ScreenState } from '../screen/parse.js';
import { buildToolApproval } from './gate.js';
import { SYSTEM_PROMPT, taskInstruction } from './prompt.js';
import { isScreenTool, pruneScreens } from './prune.js';
import { HAIKU_PRICING, readUsage, recordStep, type StepLike } from './record.js';
import { pickWorkerTools } from './tools.js';

export interface RunTaskOpts {
  readonly db: DatabaseSync; readonly identity: IdentityRow; readonly goalText: string; readonly apiKey: string;
  readonly isKilled: () => boolean; readonly onStep: () => void; readonly stepBudget?: number;
}
export interface RunTaskResult {
  readonly taskId: string; readonly outcome: 'done' | 'budget' | 'killed' | 'platform-block' | 'infra' | 'failed';
  readonly costUsd: number; readonly usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
  readonly platformBlock: string | null; readonly summary: string;
}
/** Dependências injetáveis para teste: conexão MCP e a função de geração. */
export interface RunTaskDeps {
  readonly connect: (url: string, token: string) => Promise<{ tools(): Promise<ToolSet>; close(): Promise<void> }>;
  readonly generate: typeof generateText;
}

type Halt = { kind: 'platform-block'; text: string } | { kind: 'infra'; text: string } | null;

function textOf(result: unknown): string {
  if (typeof result === 'string') return result;
  const r = result as { content?: { type: string; text?: string }[] };
  return r?.content?.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n') ?? JSON.stringify(result);
}

function classify(e: unknown): Halt {
  const msg = String((e as Error)?.message ?? e);
  if (/401|unauthorized|not found|offline|ECONNREFUSED|fetch failed/i.test(msg)) return { kind: 'infra', text: msg.slice(0, 200) };
  return null;
}

/** Envolve cada tool do MCP para ler telas, detectar bloqueio e classificar falhas de infra. */
function wrapTools(tools: ToolSet, onScreen: (s: ScreenState) => void, onHalt: (h: Halt) => void): ToolSet {
  return Object.fromEntries(Object.entries(tools).map(([name, t]) => {
    const base = t as Tool & { execute?: (input: unknown, opts: unknown) => Promise<unknown> };
    const execute = async (input: unknown, opts: unknown) => {
      try {
        const out = await base.execute!(input, opts);
        if (isScreenTool(name)) onScreen(parseScreen(textOf(out)));
        return out;
      } catch (e) { const h = classify(e); if (h) onHalt(h); throw e; }
    };
    return [name, { ...base, execute } as Tool];
  }));
}

export async function runTask(o: RunTaskOpts, deps: RunTaskDeps = { connect: connectMcp, generate: generateText }): Promise<RunTaskResult> {
  const { db, identity } = o;
  const budget = o.stepBudget ?? Number(process.env.ENXAME_STEP_BUDGET ?? CONFIG.worker.stepBudget);
  const { taskId } = createGoalAndTask(db, identity.id, o.goalText);
  setIdentityState(db, identity.id, 'running', { lastError: null });

  let lastScreen: ScreenState | null = null; let halt: Halt = null; let costUsd = 0;
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  const finish = (outcome: RunTaskResult['outcome'], summary: string): RunTaskResult => {
    const idState = outcome === 'platform-block' ? 'needs-human' : outcome === 'infra' ? 'offline' : 'idle';
    setIdentityState(db, identity.id, idState, { lastError: halt?.text ?? (outcome === 'failed' ? summary.slice(0, 200) : null) });
    setTaskState(db, taskId, outcome === 'done' || outcome === 'budget' || outcome === 'killed' ? 'done' : outcome === 'infra' ? 'todo' : outcome === 'platform-block' ? 'needs-human' : 'failed');
    return { taskId, outcome, costUsd, usage, platformBlock: halt?.kind === 'platform-block' ? halt.text : null, summary };
  };

  let client: Awaited<ReturnType<RunTaskDeps['connect']>> | null = null;
  try {
    client = await deps.connect(`http://127.0.0.1:${identity.mcpHostPort}/mcp`, identity.mcpToken);
    const slug = identity.deviceSlug || null;
    const mcpTools = wrapTools(pickWorkerTools(await client.tools(), slug),
      (s) => { lastScreen = s; const b = detectPlatformBlock(s); if (b) halt = { kind: 'platform-block', text: b }; },
      (h) => { halt = h; });
    const ledgerTool = tool({
      description: 'Registra um item tratado nesta identidade e diz se já existia. Chame ANTES de tratar.',
      inputSchema: z.object({ item_key: z.string().min(3), author: z.string(), excerpt: z.string().max(300), draft_reply: z.string().max(500) }),
      execute: async (i) => { const already = ledgerHas(db, identity.id, i.item_key); if (!already) ledgerPut(db, identity.id, i.item_key, 'comment', `@${i.author}: ${i.excerpt} → rascunho: ${i.draft_reply}`); return { already }; },
    });
    const tools: ToolSet = { ...mcpTools, ledger_record: ledgerTool };
    const stopIfHalted: StopCondition<ToolSet> = () => halt !== null || o.isKilled();
    const anthropic = createAnthropic({ apiKey: o.apiKey });
    const messages: ModelMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT, providerOptions: { anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } } } },
      { role: 'user', content: taskInstruction(o.goalText) },
    ];
    const result = await deps.generate({
      model: anthropic(CONFIG.models.worker), messages, tools,
      toolApproval: buildToolApproval(slug, () => lastScreen, 'read-only') as never,
      stopWhen: [stepCountIs(budget), stopIfHalted],
      prepareStep: ({ messages: m }) => ({ messages: pruneScreens(m, CONFIG.worker.keepScreens) }),
      onStepFinish: (step) => {
        const r = recordStep(db, taskId, step as unknown as StepLike, HAIKU_PRICING); costUsd += r.costUsd;
        const u = readUsage(step.usage as never); usage.inputTokens += u.inputTokens; usage.outputTokens += u.outputTokens; usage.cacheReadTokens += u.cacheReadTokens;
        o.onStep();
      },
    });
    if (halt?.kind === 'platform-block') return finish('platform-block', result.text);
    if (halt?.kind === 'infra') return finish('infra', result.text);
    if (o.isKilled()) return finish('killed', result.text);
    return finish((result.steps?.length ?? 0) >= budget ? 'budget' : 'done', result.text);
  } catch (e) {
    const h = classify(e); if (h) halt = h;
    return finish(halt?.kind === 'infra' ? 'infra' : halt?.kind === 'platform-block' ? 'platform-block' : 'failed', String((e as Error).message ?? e));
  } finally {
    await client?.close().catch(() => undefined);
  }
}
```

- [ ] **Step 7: Rodar e ver passar**

Run: `npx vitest run --project daemon daemon/test/record.test.ts daemon/test/run.test.ts && npm run daemon:build`
Expected: PASS (9 tests); build sem erros. Se `toolApproval` reclamar de tipo, o `as never` já está no lugar certo — o ToolSet do MCP é dinâmico e o tipo genérico não fecha em tempo de compilação.

- [ ] **Step 8: Commit**

```bash
git add daemon/src/db/tasks.ts daemon/src/worker daemon/test/record.test.ts daemon/test/run.test.ts
git commit -m "feat(worker): loop com AI SDK 7 — write-ahead, ledger, gate, poda e custo por passo"
```

---

### Task 9: API do daemon (HTTP + WebSocket) e snapshot

**Files:**
- Create: `daemon/src/server/snapshot.ts`, `daemon/src/server/api.ts`, `daemon/src/server/ws.ts`, `daemon/src/index.ts`
- Test: `daemon/test/server.test.ts`

**Interfaces:**
- Consumes: `openDb`, `listIdentities` (Task 1); `ensureIdentityReady` (Task 6); `runTask` (Task 8); `CONFIG`.
- Produces: `type FleetSnapshot = { identities: readonly IdentitySnapshot[]; killed: boolean; updatedAt: string }`; `type IdentitySnapshot = { id; name; handle; state; task: string; steps: number; budget: number; costUsd: number; error: string; lastTools: readonly { idx; tool; excerpt; tokens; gate: boolean }[] }`; `buildSnapshot(db, killed): FleetSnapshot`; `startServer(opts: { db; port?: 0 | number; token: string; onGoal: (text) => Promise<void>; onKill: () => void }): Promise<{ port: number; broadcast(): void; close(): Promise<void> }>`. Rotas: `GET /state` (Bearer) → snapshot; `POST /goals {text}` → 202; `POST /kill` → 200; WS em `/ws?token=` recebe `{type:'snapshot', data}` a cada `broadcast()`.

- [ ] **Step 1: Teste (falha)**

`daemon/test/server.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { openDb } from '../src/db/open.js';
import { upsertIdentity } from '../src/db/identities.js';
import { startServer } from '../src/server/api.js';

let stop: (() => Promise<void>) | null = null;
afterEach(async () => { await stop?.(); stop = null; });

const row = { id: 'conta1', name: 'conta1', handle: '@a', avdName: 'x', serial: 'emulator-5554', consolePort: 5554, mcpHostPort: 8080, mcpToken: 't', deviceSlug: 'conta1', appPackage: 'com.instagram.android', appVersionName: '448.0.0.52.84', state: 'idle' as const };

describe('servidor do daemon', () => {
  it('GET /state exige bearer e devolve snapshot', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const s = await startServer({ db, port: 0, token: 'seg', onGoal: async () => {}, onKill: () => {} }); stop = s.close;
    expect((await fetch(`http://127.0.0.1:${s.port}/state`)).status).toBe(401);
    const r = await fetch(`http://127.0.0.1:${s.port}/state`, { headers: { authorization: 'Bearer seg' } });
    const body = await r.json() as { identities: { id: string; state: string }[] };
    expect(body.identities[0]).toMatchObject({ id: 'conta1', state: 'idle' });
  });
  it('POST /goals valida corpo e chama onGoal; POST /kill chama onKill', async () => {
    const db = openDb(':memory:'); const goals: string[] = []; let killed = false;
    const s = await startServer({ db, port: 0, token: 'seg', onGoal: async (t) => { goals.push(t); }, onKill: () => { killed = true; } }); stop = s.close;
    const h = { authorization: 'Bearer seg', 'content-type': 'application/json' };
    expect((await fetch(`http://127.0.0.1:${s.port}/goals`, { method: 'POST', headers: h, body: '{}' })).status).toBe(400);
    expect((await fetch(`http://127.0.0.1:${s.port}/goals`, { method: 'POST', headers: h, body: JSON.stringify({ text: 'Levantar comentários' }) })).status).toBe(202);
    expect((await fetch(`http://127.0.0.1:${s.port}/kill`, { method: 'POST', headers: h })).status).toBe(200);
    expect(goals).toEqual(['Levantar comentários']); expect(killed).toBe(true);
  });
  it('WS recebe snapshot no connect e a cada broadcast', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const s = await startServer({ db, port: 0, token: 'seg', onGoal: async () => {}, onKill: () => {} }); stop = s.close;
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws?token=seg`);
    const msgs: string[] = [];
    await new Promise<void>((r) => { ws.on('message', (m) => { msgs.push(String(m)); if (msgs.length === 2) r(); }); ws.on('open', () => s.broadcast()); });
    expect(JSON.parse(msgs[0]).type).toBe('snapshot'); ws.close();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --project daemon daemon/test/server.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar**

`daemon/src/server/snapshot.ts`:

```ts
import type { DatabaseSync } from 'node:sqlite';
import { listIdentities } from '../db/identities.js';

export interface ToolRow { readonly idx: number; readonly tool: string; readonly excerpt: string; readonly tokens: number; readonly gate: boolean }
export interface IdentitySnapshot {
  readonly id: string; readonly name: string; readonly handle: string; readonly state: string; readonly task: string;
  readonly steps: number; readonly budget: number; readonly costUsd: number; readonly error: string; readonly lastTools: readonly ToolRow[];
}
export interface FleetSnapshot { readonly identities: readonly IdentitySnapshot[]; readonly killed: boolean; readonly updatedAt: string }

const BUDGET = 30;

export function buildSnapshot(db: DatabaseSync, killed: boolean): FleetSnapshot {
  const identities = listIdentities(db).map((id) => {
    const task = db.prepare("select id, instruction, state, cost_usd from task where identity_id=? order by created_at desc limit 1").get(id.id) as
      { id: string; instruction: string; state: string; cost_usd: number } | undefined;
    const steps = task ? (db.prepare('select count(*) as n from step where task_id=?').get(task.id) as { n: number }).n : 0;
    const lastTools = task ? (db.prepare('select idx, tool, result_excerpt, input_tokens, output_tokens, args_json from step where task_id=? order by idx desc limit 6').all(task.id) as
      { idx: number; tool: string | null; result_excerpt: string | null; input_tokens: number | null; output_tokens: number | null; args_json: string | null }[])
      .map((s) => ({ idx: s.idx, tool: s.tool ?? '—', excerpt: s.result_excerpt ?? '', tokens: (s.input_tokens ?? 0) + (s.output_tokens ?? 0), gate: (s.result_excerpt ?? '').startsWith('GATE') })) : [];
    return {
      id: id.id, name: id.name, handle: id.handle, state: id.state, task: task?.instruction ?? 'Aguardando',
      steps, budget: BUDGET, costUsd: task?.cost_usd ?? 0, error: id.lastError ?? '', lastTools,
    };
  });
  return { identities, killed, updatedAt: new Date().toISOString() };
}
```

`daemon/src/server/api.ts`:

```ts
import http from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { buildSnapshot } from './snapshot.js';
import { attachWs } from './ws.js';

const GoalBody = z.object({ text: z.string().min(3).max(2000) });

export interface ServerOpts {
  readonly db: DatabaseSync; readonly port?: number; readonly token: string;
  readonly onGoal: (text: string) => Promise<void>; readonly onKill: () => void;
}

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve(null); } }); });
}

export async function startServer(o: ServerOpts): Promise<{ port: number; broadcast(): void; close(): Promise<void> }> {
  let killed = false;
  const send = (res: http.ServerResponse, code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.headers.authorization !== `Bearer ${o.token}`) return send(res, 401, { error: 'unauthorized' });
    if (req.method === 'GET' && url.pathname === '/state') return send(res, 200, buildSnapshot(o.db, killed));
    if (req.method === 'POST' && url.pathname === '/goals') {
      const parsed = GoalBody.safeParse(await readJson(req));
      if (!parsed.success) return send(res, 400, { error: parsed.error.issues.map((i) => i.message) });
      void o.onGoal(parsed.data.text);
      return send(res, 202, { accepted: true });
    }
    if (req.method === 'POST' && url.pathname === '/kill') { killed = true; o.onKill(); return send(res, 200, { killed: true }); }
    if (req.method === 'POST' && url.pathname === '/resume') { killed = false; return send(res, 200, { killed: false }); }
    return send(res, 404, { error: 'not found' });
  });
  const ws = attachWs(server, o.token, () => buildSnapshot(o.db, killed));
  await new Promise<void>((r) => server.listen(o.port ?? 47800, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return { port, broadcast: ws.broadcast, close: async () => { ws.close(); await new Promise<void>((r) => server.close(() => r())); } };
}
```

`daemon/src/server/ws.ts`:

```ts
import type http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { FleetSnapshot } from './snapshot.js';

export function attachWs(server: http.Server, token: string, snapshot: () => FleetSnapshot): { broadcast(): void; close(): void } {
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/ws' || url.searchParams.get('token') !== token) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => { wss.emit('connection', ws, req); ws.send(JSON.stringify({ type: 'snapshot', data: snapshot() })); });
  });
  const broadcast = () => {
    const msg = JSON.stringify({ type: 'snapshot', data: snapshot() });
    for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(msg);
  };
  return { broadcast, close: () => { for (const c of wss.clients) c.terminate(); wss.close(); } };
}
```

`daemon/src/index.ts` — entrada que registra a identidade real e liga tudo:

```ts
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { CONFIG, loadEnv } from './config.js';
import { createAdb } from './device/adb.js';
import { openDb } from './db/open.js';
import { getIdentity, upsertIdentity } from './db/identities.js';
import { ensureIdentityReady } from './fleet/identity.js';
import { startServer } from './server/api.js';
import { runTask } from './worker/run.js';

const env = loadEnv();
mkdirSync(CONFIG.dataDir, { recursive: true });
const db = openDb(CONFIG.dbPath);
const adb = createAdb();

// Identidade 0: o emulador já provisionado. Token vem do arquivo salvo na sessão de setup ou é gerado agora.
const tokenFile = '/tmp/claude-1000/-media-loterio-workspace-workspace-pitaia-research/mcp-token.txt';
const existing = getIdentity(db, 'conta1');
const mcpToken = existing?.mcpToken ?? (existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8').trim() : randomUUID());
upsertIdentity(db, {
  id: 'conta1', name: 'conta1', handle: '@p1t41a.meta.test', avdName: 'mcp_test_playstore', serial: 'emulator-5554',
  consolePort: 5554, mcpHostPort: 8080, mcpToken, deviceSlug: 'conta1',
  appPackage: CONFIG.targetApp.package, appVersionName: CONFIG.targetApp.versionName, state: existing?.state ?? 'logged-in',
});

const daemonToken = randomUUID();
let killed = false;
const server = await startServer({
  db, token: daemonToken,
  onKill: () => { killed = true; server.broadcast(); },
  onGoal: async (text) => {
    killed = false;
    const id = getIdentity(db, 'conta1'); if (!id) return;
    const probe = await ensureIdentityReady(db, id, { adb }); server.broadcast();
    if (!probe.ready) return;
    await runTask({ db, identity: getIdentity(db, 'conta1')!, goalText: text, apiKey: env.anthropicApiKey, isKilled: () => killed, onStep: () => server.broadcast() });
    server.broadcast();
  },
});
writeFileSync(CONFIG.daemonInfoPath, JSON.stringify({ port: server.port, token: daemonToken, pid: process.pid }));
console.log(`[enxame-daemon] http://127.0.0.1:${server.port} · info em ${CONFIG.daemonInfoPath}`);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run --project daemon daemon/test/server.test.ts && npm run daemon:build`
Expected: PASS (3 tests); build sem erros

- [ ] **Step 5: Commit**

```bash
git add daemon/src/server daemon/src/index.ts daemon/test/server.test.ts
git commit -m "feat(daemon): API HTTP/WS local com token, snapshot da frota e entrada do daemon"
```

---

### Task 10: Ponte Electron → renderer e sobreposição do estado vivo

**Files:**
- Create: `electron/daemon-bridge.ts`, `src/live/types.ts`, `src/live/useLiveFleet.ts`, `src/live/merge.ts`
- Modify: `electron/main.ts` (spawn + IPC), `electron/preload.ts` (API `enxame`), `src/App.tsx` (usar merge e log vivo), `src/vite-env.d.ts` (tipar `window.enxame`)
- Test: `src/live/merge.test.ts`

**Interfaces:**
- Consumes: `FleetSnapshot`/`IdentitySnapshot` (Task 9, espelhados em `src/live/types.ts` — mesmo shape, sem import cruzado).
- Produces: `window.enxame.onSnapshot(cb: (s: FleetSnapshot) => void): () => void`; `window.enxame.startGoal(text: string): Promise<void>`; `window.enxame.kill(): Promise<void>`; `useLiveFleet(): FleetSnapshot | null`; `mergeLive(ids: readonly Identity[], live: FleetSnapshot | null): readonly Identity[]` (substitui o índice 0 pelos campos vivos; demais intactos); `liveLogFor(live, name): readonly LogRow[] | null`.

- [ ] **Step 1: Teste do merge (falha)**

`src/live/merge.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { IDENTITIES } from '../data/identities';
import { mergeLive } from './merge';

const live = {
  killed: false, updatedAt: 'x',
  identities: [{ id: 'conta1', name: 'conta1', handle: '@p1t41a.meta.test', state: 'needs-human', task: 'Levantar comentários', steps: 12, budget: 30, costUsd: 0.07, error: 'checkpoint', lastTools: [] }],
};

describe('mergeLive', () => {
  it('sem snapshot devolve o mock intacto', () => {
    expect(mergeLive(IDENTITIES, null)).toBe(IDENTITIES);
  });
  it('sobrepõe só a identidade 0 e traduz needs-human → needs', () => {
    const out = mergeLive(IDENTITIES, live);
    expect(out[0]).toMatchObject({ handle: '@p1t41a.meta.test', state: 'needs', steps: 12, budget: 30, error: 'checkpoint' });
    expect(out[1]).toBe(IDENTITIES[1]);
    expect(IDENTITIES[0].handle).toBe('@aurora.moda');
  });
  it('traduz offline e idle/running/logged-in', () => {
    const st = (s: string) => mergeLive(IDENTITIES, { ...live, identities: [{ ...live.identities[0], state: s }] })[0].state;
    expect(st('offline')).toBe('offline'); expect(st('running')).toBe('running'); expect(st('logged-in')).toBe('idle'); expect(st('idle')).toBe('idle');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --project renderer src/live/merge.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar tipos, merge e hook**

`src/live/types.ts`:

```ts
export interface LiveToolRow { readonly idx: number; readonly tool: string; readonly excerpt: string; readonly tokens: number; readonly gate: boolean }
export interface LiveIdentity {
  readonly id: string; readonly name: string; readonly handle: string; readonly state: string; readonly task: string;
  readonly steps: number; readonly budget: number; readonly costUsd: number; readonly error: string; readonly lastTools: readonly LiveToolRow[];
}
export interface FleetSnapshot { readonly identities: readonly LiveIdentity[]; readonly killed: boolean; readonly updatedAt: string }
export interface EnxameBridge {
  readonly onSnapshot: (cb: (s: FleetSnapshot) => void) => () => void;
  readonly startGoal: (text: string) => Promise<void>;
  readonly kill: () => Promise<void>;
}
```

`src/live/merge.ts`:

```ts
import type { LogRow } from '../state/selectors';
import type { DeviceState, Identity } from '../types/fleet';
import type { FleetSnapshot } from './types';

const STATE_MAP: Readonly<Record<string, DeviceState>> = {
  running: 'running', idle: 'idle', 'logged-in': 'idle', restored: 'idle', dirty: 'idle', provisioned: 'idle', blank: 'idle',
  'needs-human': 'needs', banned: 'needs', offline: 'offline',
};

/** Sobrepõe a identidade viva (índice 0) ao mock, sem tocar nas demais. */
export function mergeLive(ids: readonly Identity[], live: FleetSnapshot | null): readonly Identity[] {
  const l = live?.identities[0];
  if (!l || ids.length === 0) return ids;
  const first: Identity = {
    ...ids[0], name: l.name, handle: l.handle, state: STATE_MAP[l.state] ?? 'offline',
    task: l.task, steps: l.steps, budget: l.budget, cost: l.costUsd, error: l.error,
  };
  return [first, ...ids.slice(1)];
}

export function liveLogFor(live: FleetSnapshot | null, name: string): readonly LogRow[] | null {
  const l = live?.identities.find((i) => i.name === name);
  if (!l || l.lastTools.length === 0) return null;
  return l.lastTools.map((t) => ({ i: String(t.idx), tool: t.tool, desc: t.excerpt, tokens: `${(t.tokens / 1000).toFixed(1)}k tok`, tag: t.gate ? 'gate' : 'ok' }));
}
```

`src/live/useLiveFleet.ts`:

```ts
import { useEffect, useState } from 'react';
import type { FleetSnapshot } from './types';

/** Assina o daemon via preload. Fora do Electron (Vite no browser) devolve null e tudo segue mock. */
export function useLiveFleet(): FleetSnapshot | null {
  const [snap, setSnap] = useState<FleetSnapshot | null>(null);
  useEffect(() => {
    const bridge = window.enxame;
    if (!bridge?.onSnapshot) return;
    return bridge.onSnapshot(setSnap);
  }, []);
  return snap;
}
```

`src/vite-env.d.ts` — substituir o bloco `interface Window`:

```ts
/// <reference types="vite/client" />
import type { EnxameBridge } from './live/types';

declare global {
  interface Window { readonly enxame?: Partial<EnxameBridge> & { readonly platform?: string; readonly version?: string } }
}
export {};
```

- [ ] **Step 4: Ponte no Electron**

`electron/daemon-bridge.ts`:

```ts
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const INFO = path.join(os.homedir(), '.local', 'share', 'enxame', 'daemon.json');
type Info = { port: number; token: string; pid: number };

function readInfo(): Info | null {
  try { return existsSync(INFO) ? (JSON.parse(readFileSync(INFO, 'utf8')) as Info) : null; } catch { return null; }
}
function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }

/** Sobe o daemon com o Node do sistema (o do Electron é 20.x, sem node:sqlite) se não houver um vivo. */
export function ensureDaemon(projectRoot: string): ChildProcess | null {
  const info = readInfo();
  if (info && alive(info.pid)) return null;
  const child = spawn('node', ['--env-file=.env', 'dist-daemon/index.js'], { cwd: projectRoot, stdio: 'inherit', env: process.env });
  return child;
}

export async function waitForInfo(timeoutMs = 15000): Promise<Info> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const info = readInfo();
    if (info && alive(info.pid)) return info;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('daemon não respondeu em 15 s');
}

export function connectSnapshots(info: Info, onSnapshot: (data: unknown) => void): () => void {
  const ws = new WebSocket(`ws://127.0.0.1:${info.port}/ws?token=${info.token}`);
  ws.on('message', (m) => { const msg = JSON.parse(String(m)) as { type: string; data: unknown }; if (msg.type === 'snapshot') onSnapshot(msg.data); });
  return () => ws.close();
}

export async function post(info: Info, pathname: string, body?: unknown): Promise<void> {
  const r = await fetch(`http://127.0.0.1:${info.port}${pathname}`, {
    method: 'POST', headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${pathname} → ${r.status}`);
}
```

`electron/main.ts` — dentro de `app.whenReady().then(...)`, depois de `createWindow()`:

```ts
import { ipcMain } from 'electron';
import { connectSnapshots, ensureDaemon, post, waitForInfo } from './daemon-bridge.js';

// ...
const projectRoot = path.join(here, '..');
ensureDaemon(projectRoot);
waitForInfo().then((info) => {
  connectSnapshots(info, (data) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('enxame:snapshot', data); });
  ipcMain.handle('enxame:startGoal', (_e, text: string) => post(info, '/goals', { text }));
  ipcMain.handle('enxame:kill', () => post(info, '/kill'));
}).catch((e) => console.error('[enxame] sem daemon:', e.message));
```

`electron/preload.ts` — substituir o conteúdo:

```ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('enxame', {
  platform: process.platform,
  version: '0.1.0',
  onSnapshot: (cb: (s: unknown) => void) => {
    const listener = (_e: unknown, data: unknown) => cb(data);
    ipcRenderer.on('enxame:snapshot', listener);
    return () => ipcRenderer.removeListener('enxame:snapshot', listener);
  },
  startGoal: (text: string) => ipcRenderer.invoke('enxame:startGoal', text),
  kill: () => ipcRenderer.invoke('enxame:kill'),
});
```

`tsconfig.electron.json` — `"module": "NodeNext", "moduleResolution": "NodeNext"` (imports com `.js`), e `"include": ["electron"]` já cobre o novo arquivo.

- [ ] **Step 5: Usar no App**

`src/App.tsx` — mudanças pontuais:

```tsx
import { liveLogFor, mergeLive } from './live/merge';
import { useLiveFleet } from './live/useLiveFleet';
// ...
const live = useLiveFleet();
const mergedIds = useMemo(() => mergeLive(state.ids, live), [state.ids, live]);
const tiles = useMemo(() => selectTiles({ ...state, ids: mergedIds }, FLEET_SIZE), [state, mergedIds]);
// Device: log vivo quando existir
log={liveLogFor(live, sel.name) ?? selectLog(sel)}
// Cockpit: kill e novo objetivo passam pelo daemon quando há ponte
onKill={() => { actions.kill(); void window.enxame?.kill?.(); }}
// NewGoal: onLaunch
onLaunch={() => { actions.launch(FLEET_SIZE); void window.enxame?.startGoal?.(state.goalText); }}
```

- [ ] **Step 6: Rodar testes, build e o fluxo Playwright existente**

Run: `npx vitest run && npm run build && npm run daemon:build`
Expected: todos PASS; builds limpos. O renderer no Vite puro continua 100% mock (`window.enxame` ausente).

- [ ] **Step 7: Commit**

```bash
git add electron src/live src/App.tsx src/vite-env.d.ts tsconfig.electron.json
git commit -m "feat(app): ponte Electron→daemon e sobreposição do estado vivo da identidade 0"
```

---

### Task 11: Execução real medida e relatório (critério de parada do spec)

**Files:**
- Create: `daemon/src/cli/run-real.ts`, `docs/superpowers/reports/.gitkeep`
- Test: manual e medido (é o experimento da fase 1; não há teste automatizado de conta real)

**Interfaces:**
- Consumes: tudo acima.
- Produces: `docs/superpowers/reports/2026-09-26-incremento-1.md` com: sinais da sonda, nº de passos, tools chamadas, tokens (input/output/cache read) e custo, latência média por passo, itens no ledger, se houve bloqueio de plataforma, e a tela final.

- [ ] **Step 1: CLI**

`daemon/src/cli/run-real.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { CONFIG, loadEnv } from '../config.js';
import { createAdb } from '../device/adb.js';
import { openDb } from '../db/open.js';
import { getIdentity } from '../db/identities.js';
import { ensureIdentityReady } from '../fleet/identity.js';
import { runTask } from '../worker/run.js';

const env = loadEnv();
mkdirSync(CONFIG.dataDir, { recursive: true });
const db = openDb(CONFIG.dbPath);
const id = getIdentity(db, 'conta1');
if (!id) throw new Error('rode o daemon uma vez para registrar conta1');

const t0 = Date.now();
const probe = await ensureIdentityReady(db, id, { adb: createAdb() });
if (!probe.ready) { console.error('sonda falhou:', probe.details); process.exit(2); }

const result = await runTask({ db, identity: getIdentity(db, 'conta1')!, goalText: 'Levantar comentários recentes sem resposta e propor rascunhos (não enviar)', apiKey: env.anthropicApiKey, isKilled: () => false, onStep: () => {} });
const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
const steps = db.prepare('select idx, tool, result_excerpt, input_tokens, output_tokens, cache_read_tokens, latency_ms from step where task_id=? order by idx').all(result.taskId) as Record<string, unknown>[];
const ledger = (db.prepare('select count(*) as n from ledger where identity_id=?').get('conta1') as { n: number }).n;
const lines = [
  `# Incremento 1 — execução real (${new Date().toISOString()})`, '',
  `- Sonda: ${JSON.stringify(probe.signals)}`,
  `- Resultado: **${result.outcome}** · ${steps.length} passos em ${elapsed} s · custo **US$ ${result.costUsd.toFixed(4)}**`,
  `- Tokens: in ${result.usage.inputTokens} · out ${result.usage.outputTokens} · cache read ${result.usage.cacheReadTokens}`,
  `- Itens no ledger: ${ledger} · bloqueio de plataforma: ${result.platformBlock ?? 'nenhum'}`, '',
  '| # | tool | tokens | ms | resultado |', '|---|---|---|---|---|',
  ...steps.map((s) => `| ${s.idx} | ${s.tool ?? '—'} | ${(Number(s.input_tokens) || 0) + (Number(s.output_tokens) || 0)} | ${s.latency_ms ?? ''} | ${String(s.result_excerpt ?? '').slice(0, 80).replace(/\|/g, '/')} |`),
  '', '## Resumo do agente', '', String(result.summary),
];
mkdirSync('docs/superpowers/reports', { recursive: true });
const out = `docs/superpowers/reports/2026-09-26-incremento-1.md`;
writeFileSync(out, lines.join('\n'));
console.log(`relatório em ${out}`);
```

- [ ] **Step 2: Pré-condições (manual, uma vez)**

```bash
cp .env.example .env && $EDITOR .env          # ANTHROPIC_API_KEY=... (a mesma do ~/.zshrc)
/home/loterio/Android/Sdk/platform-tools/adb devices   # emulator-5554 device
npm run daemon:build && node --env-file=.env dist-daemon/index.js &   # registra conta1; Ctrl-C depois
```

- [ ] **Step 3: Rodar com orçamento pequeno primeiro**

Run: `ENXAME_STEP_BUDGET=10 npm run real:run`
Expected: relatório gerado; `outcome` em `done` ou `budget`; **zero** chamadas negadas pelo gate registradas como executadas; nenhuma linha com `platform-block`.

- [ ] **Step 4: Rodar com o orçamento padrão (30) e abrir o app**

Run: `npm run real:run && npm run electron:dev`
Expected: o tile `conta1` mostra `@p1t41a.meta.test`, passos e custo reais; a tela Device lista as tools chamadas com `gate` onde o gate negou. Anexar o relatório ao commit.

- [ ] **Step 5: Commit**

```bash
git add daemon/src/cli docs/superpowers/reports
git commit -m "feat: execução real medida do incremento 1 e relatório"
```

---

## Verificação final do incremento

- `npx vitest run` — todos os projetos verdes.
- `ENXAME_INTEGRATION=1 ENXAME_MCP_TOKEN=$(cat /tmp/claude-1000/-media-loterio-workspace-workspace-pitaia-research/mcp-token.txt) npx vitest run --project daemon` — integração contra o emulador verde.
- `node .verify/interact.cjs` (Playwright, com Vite puro) — os 14 checks anteriores continuam PASS (o renderer sem ponte é 100% mock).
- Relatório de execução real presente em `docs/superpowers/reports/` com custo e tokens.
- **Critério de parada (§9):** se o relatório mostrar bloqueio de plataforma com ≤ 30 passos somente-leitura, **parar aqui** e voltar ao spec antes de qualquer fase 2 de frota.
