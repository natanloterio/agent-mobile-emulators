# Onboarding de primeira execução — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na primeira execução, o Enxame verifica as dependências (Node, Android SDK, emulador, imagem, KVM, Ollama, modelo, chaveiro), instala o que falta sem sudo e configura os papéis de modelo, numa tela de quatro passos igual ao mockup aprovado.

**Architecture:** O motor de verificação e instalação roda no processo main do Electron (`electron/setup/`), porque o daemon depende justamente do que está sendo instalado. O main grava `setup.json` com os caminhos resolvidos; o daemon passa a ler `adb`, `emulator` e o binário do Ollama de lá. O renderer ganha `src/onboarding/` (reducer e seletores puros testados em node, componentes finos) e um `Root` que decide entre onboarding e `App`.

**Tech Stack:** Electron 33 (Node 20 no main), React 18, TypeScript, zod 4, vitest (ambiente node), `extract-zip` (novo), `tar` do sistema (gzip e zstd), `@napi-rs/keyring` (já instalado).

**Spec:** `docs/superpowers/specs/2026-09-27-onboarding-design.md` · mockup `design/onboarding.html`

## Global Constraints

- Só Linux x86_64 (`process.platform === 'linux' && os.arch() === 'x64'`); nas outras plataformas o onboarding nunca aparece e o app sobe como hoje.
- Nada de sudo: tudo instala em `~/Android/Sdk` (ou `ANDROID_HOME`/`ANDROID_SDK_ROOT`) e em `<dados>/tools/`, onde `<dados>` = `ENXAME_DATA_DIR` || `~/.local/share/enxame`.
- Node mínimo para o daemon: 24.
- Imagem do sistema: `system-images;android-34;google_apis_playstore;x86_64`.
- Downloads fixados: JRE `OpenJDK17U-jre_x64_linux_hotspot_17.0.20.1_1.tar.gz` sha256 `0b2b640e3046b64c8ec504de0ab9d91bb5610182bda21fad454681ce54d45a62`; cmdline-tools `commandlinetools-linux-16111833_latest.zip` sha1 `e025545c62a8e64c7559119566a569fb1dec5f60`; Ollama `v0.34.4/ollama-linux-amd64.tar.zst` sha256 `c238986e61d40c0cc5f4a9b9e40b9eea104350b77efa34741fc134e105cb9533`.
- Modelo local padrão: `gpt-oss:20b`; endpoint local `http://127.0.0.1:11434/v1`; modelos de nuvem iguais a `CLOUD_MODEL` em `daemon/src/provider/config.ts` (`lider: claude-sonnet-5`, `worker`/`esc: claude-haiku-4-5`).
- A chave da Anthropic nunca vai para arquivo nem para o canal genérico `enxame:api`; só pelo IPC dedicado do main até a rota `PUT /settings/anthropic-key`.
- Todo texto de tela passa pelo i18n nos seis idiomas (pt, en, es, fr, de, zh); o teste `src/i18n/i18n.test.ts` exige as mesmas chaves e os mesmos `{placeholders}`.
- Estilo do repo: comentários curtos em português, dados imutáveis (`readonly`, cópia em vez de mutação), validação com zod em toda fronteira (IPC, arquivo, HTTP).
- Commits no formato `feat(onboarding): …`, `fix(onboarding): …`, `test(onboarding): …`, sem linha de atribuição.

## Review Focus

1. **Instalação existente sem `setup.json`** (a máquina de quem já usa o Enxame): não pode ver o onboarding. Com todas as dependências `ok`, o main grava `setup.json` concluído sozinho. Teste em `electron/setup/startup.test.ts` (Task 7).
2. **Download interrompido** (app fechado, rede caiu): o próximo "Continuar download" retoma do `.part` com `Range`; servidor que ignora `Range` (200) recomeça do zero sem corromper. Testes em `electron/setup/download.test.ts` (Task 5).
3. **Máquina sem GPU NVIDIA** (sem `nvidia-smi`): hardware com `gpu: null`, modo padrão "Só nuvem", modelos marcados "vai rodar no processador", nada quebra. Testes em `electron/setup/hardware.test.ts` (Task 4) e `src/onboarding/view.test.ts` (Task 10).
4. **Disco cheio no meio do download ou do pull** (`ENOSPC`, ou o texto `no space left on device` vindo do Ollama ou do sdkmanager): vira erro `disk-full`, a fila para e o retry continua. Testes em `electron/setup/errors.test.ts` (Task 3) e `electron/setup/ollama-pull.test.ts` (Task 6).
5. **`tar` sem zstd** (o pacote do Ollama é `.tar.zst`): mensagem clara com `sudo apt install zstd`, não um erro cru do tar. Teste em `electron/setup/runners.test.ts` (Task 6).

---

## Mapa de arquivos

**Daemon**
- Modificar `daemon/src/config.ts` — `readSetupPaths`, `sdkRootFrom`, `ollamaBinFrom`; `CONFIG.adbPath`, `CONFIG.avd.emulatorPath`, `CONFIG.ollamaBin` saem do `setup.json`.
- Modificar `daemon/src/provider/ollama.ts` — `deps.bin ?? CONFIG.ollamaBin` no spawn.
- Criar `daemon/src/provider/api-key.ts` — chave da Anthropic: ambiente, senão cofre.
- Criar `daemon/src/server/routes-anthropic-key.ts` — `GET/PUT /settings/anthropic-key`.
- Modificar `daemon/src/index.ts` — usa `apiKeys.current()` em vez de `env.anthropicApiKey`.

**Electron (`electron/setup/`)**
- `types.ts` — DTOs trocados com o renderer.
- `errors.ts` — `SetupError` e `toSetupError`.
- `paths.ts` — onde tudo mora.
- `setup-file.ts` — lê e grava `setup.json`.
- `requests.ts` — schemas zod do que chega pelo IPC.
- `probe.ts` — detecta cada dependência.
- `hardware.ts` — RAM, CPU, GPU, disco.
- `download.ts` — download com retomada e checksum.
- `proc.ts` — roda processo e repassa linhas.
- `ollama-pull.ts` — sobe `ollama serve` temporário e faz o pull com progresso.
- `runners.ts` — um executor por item (JRE+cmdline-tools, pacotes do sdkmanager, Ollama, modelo).
- `jobs.ts` — fila sequencial que emite eventos.
- `apply.ts` — modo → patches dos três papéis.
- `anthropic-key.ts` — "Testar chave".
- `finish.ts` — grava caminhos, sobe o daemon, aplica escolhas.
- `startup.ts` — decide se o onboarding aparece.
- `ipc.ts` — registra os canais `enxame:setup:*`.
- Modificar `electron/main.ts`, `electron/preload.cts`, `electron/daemon-bridge.ts`.

**Renderer**
- Criar `src/i18n/messages/onboarding.ts`; modificar `src/i18n/messages/index.ts` e `src/i18n/messages/providers.ts`.
- Criar `src/onboarding/schema.ts`, `catalog.ts`, `reducer.ts`, `view.ts`, `useOnboarding.ts`, `Onboarding.tsx`, `CheckStep.tsx`, `ModelsStep.tsx`, `InstallStep.tsx`, `ReadyStep.tsx`, `Onboarding.css`.
- Criar `src/Root.tsx`; modificar `src/main.tsx`, `src/App.tsx`, `src/screens/Providers.tsx`, `src/live/types.ts`.

---

### Task 1: Daemon lê caminhos do `setup.json`

**Files:**
- Modify: `daemon/src/config.ts`
- Modify: `daemon/src/provider/ollama.ts:27` (tipo `OllamaDeps`) e `:145` (spawn)
- Create: `daemon/test/config-setup.test.ts`
- Modify: `daemon/test/ollama.test.ts` (harness passa `bin`)

**Interfaces:**
- Produces: `readSetupPaths(file: string, read?: (p: string) => string): SetupPaths`, `sdkRootFrom(setup: SetupPaths, env: NodeJS.ProcessEnv, home: string): string`, `ollamaBinFrom(setup: SetupPaths, env: NodeJS.ProcessEnv): string`, `interface SetupPaths { sdkRoot: string | null; ollamaBin: string | null }`, `CONFIG.sdkRoot`, `CONFIG.ollamaBin`. Formato do arquivo (compartilhado com a Task 3): `{ "version": 1, "completedAt": string | null, "paths": { "sdkRoot": string, "ollamaBin": string | null } }`.

- [ ] **Step 1: Escrever o teste que falha**

`daemon/test/config-setup.test.ts`:

```ts
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ollamaBinFrom, readSetupPaths, sdkRootFrom } from '../src/config.js';

const none = { sdkRoot: null, ollamaBin: null };

describe('readSetupPaths: caminhos gravados pelo onboarding', () => {
  it('lê sdkRoot e ollamaBin do setup.json', () => {
    const read = () => JSON.stringify({ version: 1, completedAt: null, paths: { sdkRoot: '/opt/sdk', ollamaBin: '/x/ollama' } });
    expect(readSetupPaths('/d/setup.json', read)).toEqual({ sdkRoot: '/opt/sdk', ollamaBin: '/x/ollama' });
  });
  it('arquivo ausente, JSON quebrado ou formato errado: tudo null', () => {
    const missing = () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); };
    expect(readSetupPaths('/d/setup.json', missing)).toEqual(none);
    expect(readSetupPaths('/d/setup.json', () => '{')).toEqual(none);
    expect(readSetupPaths('/d/setup.json', () => '{"paths":{"sdkRoot":3}}')).toEqual(none);
  });
});

describe('sdkRootFrom', () => {
  it('setup.json vence as variáveis de ambiente', () => {
    expect(sdkRootFrom({ sdkRoot: '/opt/sdk', ollamaBin: null }, { ANDROID_HOME: '/env/sdk' }, '/home/u')).toBe('/opt/sdk');
  });
  it('ANDROID_HOME, depois ANDROID_SDK_ROOT, depois ~/Android/Sdk; vazio não conta', () => {
    expect(sdkRootFrom(none, { ANDROID_HOME: '/a', ANDROID_SDK_ROOT: '/b' }, '/home/u')).toBe('/a');
    expect(sdkRootFrom(none, { ANDROID_HOME: '', ANDROID_SDK_ROOT: '/b' }, '/home/u')).toBe('/b');
    expect(sdkRootFrom(none, {}, '/home/u')).toBe(path.join('/home/u', 'Android', 'Sdk'));
  });
});

describe('ollamaBinFrom', () => {
  it('ENXAME_OLLAMA_BIN, depois setup.json, depois "ollama" do PATH', () => {
    expect(ollamaBinFrom({ sdkRoot: null, ollamaBin: '/s/ollama' }, { ENXAME_OLLAMA_BIN: '/e/ollama' })).toBe('/e/ollama');
    expect(ollamaBinFrom({ sdkRoot: null, ollamaBin: '/s/ollama' }, {})).toBe('/s/ollama');
    expect(ollamaBinFrom(none, {})).toBe('ollama');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --project daemon daemon/test/config-setup.test.ts`
Expected: FAIL — `readSetupPaths is not a function` (ou erro de import).

- [ ] **Step 3: Implementar em `daemon/src/config.ts`**

Trocar a linha de import de `node:fs` por `import { existsSync, readFileSync } from 'node:fs';` e acrescentar, logo depois de `const AVD_HOME = …`:

```ts
/** Caminhos que o onboarding (electron/setup) grava em `<dados>/setup.json`; o daemon só lê. */
export interface SetupPaths { readonly sdkRoot: string | null; readonly ollamaBin: string | null }
const NO_SETUP: SetupPaths = { sdkRoot: null, ollamaBin: null };
const SetupFileSchema = z.object({ paths: z.object({ sdkRoot: z.string().min(1), ollamaBin: z.string().min(1).nullable() }) });

/** Arquivo ausente, ilegível ou com outro formato: nenhum caminho (cai nos padrões). */
export function readSetupPaths(file: string, read: (p: string) => string = (p) => readFileSync(p, 'utf8')): SetupPaths {
  try {
    const parsed = SetupFileSchema.safeParse(JSON.parse(read(file)));
    return parsed.success ? parsed.data.paths : NO_SETUP;
  } catch { return NO_SETUP; }
}

/** SDK do Android: setup.json, `ANDROID_HOME`, `ANDROID_SDK_ROOT`, senão `~/Android/Sdk` (string vazia não conta). */
export function sdkRootFrom(setup: SetupPaths, env: NodeJS.ProcessEnv, home: string): string {
  return setup.sdkRoot || env.ANDROID_HOME || env.ANDROID_SDK_ROOT || path.join(home, 'Android', 'Sdk');
}

/** Binário do Ollama: `ENXAME_OLLAMA_BIN`, o que o onboarding instalou ou achou, senão o `ollama` do PATH. */
export function ollamaBinFrom(setup: SetupPaths, env: NodeJS.ProcessEnv): string {
  return env.ENXAME_OLLAMA_BIN || setup.ollamaBin || 'ollama';
}

const SETUP = readSetupPaths(path.join(DATA_DIR, 'setup.json'));
const SDK_ROOT = sdkRootFrom(SETUP, process.env, os.homedir());
```

No objeto `CONFIG`, trocar:

```ts
  adbPath: '/home/loterio/Android/Sdk/platform-tools/adb',
```
por
```ts
  sdkRoot: SDK_ROOT,
  adbPath: path.join(SDK_ROOT, 'platform-tools', 'adb'),
  ollamaBin: ollamaBinFrom(SETUP, process.env),
```
e dentro de `avd`:
```ts
    emulatorPath: '/home/loterio/Android/Sdk/emulator/emulator',
```
por
```ts
    emulatorPath: path.join(SDK_ROOT, 'emulator', 'emulator'),
```

- [ ] **Step 4: Ollama usa o binário configurado**

Em `daemon/src/provider/ollama.ts`, no `interface OllamaDeps`, acrescentar como primeira linha:

```ts
  /** Binário do Ollama; ausente = `CONFIG.ollamaBin` (setup.json ou PATH). */
  readonly bin?: string;
```

Em `createOllamaSupervisor`, junto das outras resoluções de `deps` (antes de `let child`), acrescentar `const bin = deps.bin ?? CONFIG.ollamaBin;` e trocar na linha do spawn `spawnFn('ollama', ['serve'], …)` por `spawnFn(bin, ['serve'], …)`.

Em `daemon/test/ollama.test.ts`, no `createOllamaSupervisor({ … })` do `harness`, acrescentar `bin: 'ollama',` (o teste não pode depender do `setup.json` da máquina de quem roda). Acrescentar no `describe('supervisor do Ollama')`:

```ts
  it('spawna o binário configurado em deps.bin', async () => {
    const spawned: string[] = [];
    const sup = createOllamaSupervisor({
      bin: '/opt/enxame/ollama/bin/ollama',
      fetch: (async () => { if (spawned.length === 0) throw new Error('fetch failed: ECONNREFUSED'); return tags('gpt-oss:20b'); }) as unknown as typeof fetch,
      sleep: async () => {}, timeoutMs: 20_000, logPath: '/dev/null', openLog: () => 'ignore', findProcesses: () => [],
      spawn: (cmd) => { spawned.push(cmd); return { pid: 1, kill: () => true, on: () => undefined }; },
    });
    await sup.ensure('http://127.0.0.1:11434/v1', 'gpt-oss:20b');
    expect(spawned).toEqual(['/opt/enxame/ollama/bin/ollama']);
  });
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run --project daemon daemon/test/config-setup.test.ts daemon/test/ollama.test.ts daemon/test/config-base.test.ts`
Expected: PASS.

Run: `npm run daemon:build`
Expected: sem erros de tipo.

- [ ] **Step 6: Commit**

```bash
git add daemon/src/config.ts daemon/src/provider/ollama.ts daemon/test/config-setup.test.ts daemon/test/ollama.test.ts
git commit -m "feat(onboarding): daemon lê SDK e Ollama do setup.json em vez de caminhos fixos"
```

---

### Task 2: Chave da Anthropic no cofre do daemon

**Files:**
- Create: `daemon/src/provider/api-key.ts`
- Create: `daemon/src/server/routes-anthropic-key.ts`
- Modify: `daemon/src/index.ts`
- Test: `daemon/test/api-key.test.ts`, `daemon/test/routes-anthropic-key.test.ts`

**Interfaces:**
- Consumes: `Vault` de `daemon/src/vault/vault.ts` (`get(id)`, `put(id, value, meta?)`), `VaultError`, `Route` de `daemon/src/server/api.ts`, `issues` de `daemon/src/server/routes-credentials.ts`.
- Produces: `createApiKeyStore({ envKey, vault }): ApiKeyStore` com `current(): string`, `source(): 'env' | 'vault' | null`, `load(): Promise<void>`, `set(key): Promise<void>`; `ANTHROPIC_KEY_ENTRY = 'secret:anthropic'`; rota `GET /settings/anthropic-key` → `{ configured: boolean, source }`, `PUT /settings/anthropic-key` com `{ key }` → 204 (400 inválida, 503 cofre indisponível). A Task 7 chama o PUT.

- [ ] **Step 1: Escrever os testes que falham**

`daemon/test/api-key.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ANTHROPIC_KEY_ENTRY, createApiKeyStore } from '../src/provider/api-key.js';

const KEY = 'sk-ant-' + 'x'.repeat(30);
function memVault(initial: Record<string, string> = {}) {
  let entries = { ...initial };
  return {
    get: async (id: string) => entries[id] ?? null,
    put: async (id: string, value: string) => { entries = { ...entries, [id]: value }; },
    dump: () => entries,
  };
}

describe('createApiKeyStore', () => {
  it('chave do ambiente vence a do cofre', async () => {
    const s = createApiKeyStore({ envKey: KEY, vault: memVault({ [ANTHROPIC_KEY_ENTRY]: 'sk-ant-outra-chave-bem-longa' }) });
    await s.load();
    expect(s.current()).toBe(KEY);
    expect(s.source()).toBe('env');
  });
  it('sem ambiente, usa a do cofre depois de load()', async () => {
    const s = createApiKeyStore({ envKey: '', vault: memVault({ [ANTHROPIC_KEY_ENTRY]: KEY }) });
    expect(s.current()).toBe('');
    await s.load();
    expect(s.current()).toBe(KEY);
    expect(s.source()).toBe('vault');
  });
  it('set grava no cofre e já vale, sem reiniciar', async () => {
    const vault = memVault();
    const s = createApiKeyStore({ envKey: '', vault });
    expect(s.source()).toBeNull();
    await s.set(KEY);
    expect(s.current()).toBe(KEY);
    expect(vault.dump()).toEqual({ [ANTHROPIC_KEY_ENTRY]: KEY });
  });
});
```

`daemon/test/routes-anthropic-key.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { createApiKeyStore } from '../src/provider/api-key.js';
import { startServer } from '../src/server/api.js';
import { anthropicKeyRoutes } from '../src/server/routes-anthropic-key.js';
import { VaultError } from '../src/vault/vault.js';

let stop: (() => Promise<void>) | null = null;
afterEach(async () => { await stop?.(); stop = null; });
const h = { authorization: 'Bearer seg', 'content-type': 'application/json' };
const KEY = 'sk-ant-' + 'x'.repeat(30);

async function mk(vault: { get: (id: string) => Promise<string | null>; put: (id: string, v: string) => Promise<void> }) {
  const store = createApiKeyStore({ envKey: '', vault });
  const s = await startServer({
    db: openDb(':memory:'), port: 0, token: 'seg', onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); },
    onGoal: async () => ({ goalId: 'g', done: Promise.resolve() }), routes: [anthropicKeyRoutes({ store })],
  });
  stop = s.close;
  const call = (method: string, body?: unknown) => fetch(`http://127.0.0.1:${s.port}/settings/anthropic-key`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  return { call, store };
}

describe('rota da chave da Anthropic', () => {
  it('GET diz se há chave e de onde, nunca o valor', async () => {
    const { call } = await mk({ get: async () => null, put: async () => {} });
    expect(await (await call('GET')).json()).toEqual({ configured: false, source: null });
  });
  it('PUT válido grava e GET passa a dizer vault', async () => {
    const { call, store } = await mk({ get: async () => null, put: async () => {} });
    expect((await call('PUT', { key: KEY })).status).toBe(204);
    expect(store.current()).toBe(KEY);
    const body = await (await call('GET')).json();
    expect(body).toEqual({ configured: true, source: 'vault' });
    expect(JSON.stringify(body)).not.toContain(KEY);
  });
  it('400 para chave curta, sem sk-ant- ou campo a mais; a resposta não repete a chave', async () => {
    const { call } = await mk({ get: async () => null, put: async () => {} });
    const r = await call('PUT', { key: 'abc' });
    expect(r.status).toBe(400);
    expect(await r.text()).not.toContain('abc"');
    expect((await call('PUT', { key: 'sk-xyz-' + 'x'.repeat(30) })).status).toBe(400);
    expect((await call('PUT', { key: KEY, extra: 1 })).status).toBe(400);
  });
  it('503 quando o chaveiro do sistema recusa', async () => {
    const { call } = await mk({ get: async () => null, put: async () => { throw new VaultError('chaveiro do sistema indisponível: locked'); } });
    const r = await call('PUT', { key: KEY });
    expect(r.status).toBe(503);
    expect((await r.json()).error).toMatch(/chaveiro/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --project daemon daemon/test/api-key.test.ts daemon/test/routes-anthropic-key.test.ts`
Expected: FAIL — módulos não existem.

- [ ] **Step 3: Implementar**

`daemon/src/provider/api-key.ts`:

```ts
import type { Vault } from '../vault/vault.js';

/** Entrada do cofre com a chave gravada pelo onboarding (spec onboarding §Arquitetura). */
export const ANTHROPIC_KEY_ENTRY = 'secret:anthropic';
export type ApiKeySource = 'env' | 'vault' | null;

export interface ApiKeyStore {
  /** Chave em uso agora: `ANTHROPIC_API_KEY` do ambiente, senão a do cofre; `''` sem nenhuma. */
  current(): string;
  source(): ApiKeySource;
  /** Lê a do cofre (uma vez na subida). */
  load(): Promise<void>;
  /** Grava no cofre e já passa a valer, sem reiniciar o daemon. */
  set(key: string): Promise<void>;
}

export function createApiKeyStore(o: { readonly envKey: string; readonly vault: Pick<Vault, 'get' | 'put'> }): ApiKeyStore {
  let fromVault = '';
  return {
    current: () => o.envKey || fromVault,
    source: () => (o.envKey ? 'env' : fromVault ? 'vault' : null),
    load: async () => { fromVault = (await o.vault.get(ANTHROPIC_KEY_ENTRY)) ?? ''; },
    set: async (key) => { await o.vault.put(ANTHROPIC_KEY_ENTRY, key, null); fromVault = key; },
  };
}
```

`daemon/src/server/routes-anthropic-key.ts`:

```ts
import { z } from 'zod';
import type { ApiKeyStore } from '../provider/api-key.js';
import { VaultError } from '../vault/vault.js';
import type { Route } from './api.js';
import { issues } from './routes-credentials.js';

// Mensagens nunca repetem o valor recebido (a chave).
export const AnthropicKeyBody = z.object({
  key: z.string().trim().min(20, 'chave curta demais').max(300, 'chave longa demais').startsWith('sk-ant-', 'a chave da Anthropic começa com sk-ant-'),
}).strict();

/**
 * Chave da Anthropic no cofre (spec onboarding). Fora da lista do canal genérico do Electron: só o main chama,
 * no fim do onboarding. `GET` diz se há chave e de onde veio; nenhuma resposta traz o valor.
 */
export function anthropicKeyRoutes(o: { readonly store: ApiKeyStore }): Route {
  return async (ctx) => {
    if (ctx.url.pathname !== '/settings/anthropic-key') return false;
    if (ctx.method === 'GET') { ctx.send(200, { configured: o.store.current() !== '', source: o.store.source() }); return true; }
    if (ctx.method !== 'PUT') return false;
    const parsed = AnthropicKeyBody.safeParse(await ctx.body());
    if (!parsed.success) { ctx.send(400, { error: issues(parsed.error) }); return true; }
    try {
      await o.store.set(parsed.data.key);
      ctx.send(204);
    } catch (e) {
      if (!(e instanceof VaultError)) throw e;
      ctx.send(503, { error: e.message });
    }
    return true;
  };
}
```

- [ ] **Step 4: Ligar em `daemon/src/index.ts`**

1. Imports: acrescentar `import { createApiKeyStore } from './provider/api-key.js';` e `import { anthropicKeyRoutes } from './server/routes-anthropic-key.js';`.
2. Apagar a linha `if (!env.anthropicApiKey) console.log('[enxame-daemon] sem ANTHROPIC_API_KEY: …');` do topo.
3. Logo depois de `const vault = createVault({ … });` acrescentar:

```ts
// Chave da Anthropic: ambiente vence; sem ele, a que o onboarding gravou no cofre (spec onboarding).
const apiKeys = createApiKeyStore({ envKey: env.anthropicApiKey, vault });
await apiKeys.load().catch((e: unknown) => console.warn('[enxame-daemon] chave da Anthropic do cofre ilegível:', (e as Error).message));
if (!apiKeys.current()) console.log('[enxame-daemon] sem chave da Anthropic: papéis na nuvem ficam indisponíveis; use modelos locais em Provedores');
```

4. Trocar `const planDeps: PlanDeps = { db, ensureReady, apiKey: env.anthropicApiKey, ollama };` por
   `const planDeps = (): PlanDeps => ({ db, ensureReady, apiKey: apiKeys.current(), ollama });`
   e as duas chamadas `planGoal(text, planDeps)` / `planGoal(text, planDeps, lang)` por `planGoal(text, planDeps())` / `planGoal(text, planDeps(), lang)`.
5. Trocar cada `apiKey: env.anthropicApiKey` restante (em `runWorker`, `plan:` das missões e `runSubtask`) por `apiKey: apiKeys.current()`, e `{ anthropicApiKey: env.anthropicApiKey }` no `onProviderTest` por `{ anthropicApiKey: apiKeys.current() }`.
6. Em `routes: [ … ]`, acrescentar `anthropicKeyRoutes({ store: apiKeys })` depois de `settingsRoutes()`.

Conferir: `grep -n "env.anthropicApiKey" daemon/src/index.ts` deve mostrar só a linha do `createApiKeyStore`.

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run --project daemon && npm run daemon:build`
Expected: todos PASS, build sem erro.

- [ ] **Step 6: Commit**

```bash
git add daemon/src/provider/api-key.ts daemon/src/server/routes-anthropic-key.ts daemon/src/index.ts daemon/test/api-key.test.ts daemon/test/routes-anthropic-key.test.ts
git commit -m "feat(onboarding): chave da Anthropic no cofre do daemon, valendo sem reiniciar"
```

---

### Task 3: Base do setup no Electron (tipos, erros, caminhos, setup.json, schemas)

**Files:**
- Create: `electron/setup/types.ts`, `electron/setup/errors.ts`, `electron/setup/paths.ts`, `electron/setup/setup-file.ts`, `electron/setup/requests.ts`
- Test: `electron/setup/errors.test.ts`, `electron/setup/paths.test.ts`, `electron/setup/setup-file.test.ts`, `electron/setup/requests.test.ts`

**Interfaces:**
- Produces (usado pelas Tasks 4–8):
  - `types.ts`: `DepId`, `DepState`, `UserFix`, `DepStatus`, `Hardware`, `SetupReport`, `JobId`, `JobState`, `JobEvent`, `SetupMode`, `JOB_ORDER`.
  - `errors.ts`: `class SetupError { kind: SetupErrorKind; message }`, `type SetupErrorKind = 'disk-full' | 'network' | 'checksum' | 'process'`, `toSetupError(e: unknown): SetupError`.
  - `paths.ts`: `interface SetupPaths { dataDir; setupFile; sdkRoot; toolsDir; jreDir; downloadsDir; ollamaDir; ollamaBin; ollamaModels }`, `resolveSetupPaths(env?, home?, savedSdkRoot?: string | null): SetupPaths`.
  - `setup-file.ts`: `type SetupFileT = { version: 1; completedAt: string | null; paths: { sdkRoot: string; ollamaBin: string | null } }`, `readSetupFile(file): Promise<SetupFileT | null>`, `readSetupFileSync(file): SetupFileT | null` (só na subida do main), `writeSetupFile(file, data): Promise<void>`.
  - `requests.ts`: `InstallRequestSchema` (`{ jobs: JobId[]; localModel: string }`), `FinishRequestSchema` (`{ mode; localModel; anthropicKey: string | null }`), `AnthropicKeySchema`, tipos `InstallRequest`, `FinishRequest`.

- [ ] **Step 1: Escrever os testes que falham**

`electron/setup/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SetupError, toSetupError } from './errors';

describe('toSetupError', () => {
  it('ENOSPC e "no space left on device" viram disk-full', () => {
    expect(toSetupError(Object.assign(new Error('write'), { code: 'ENOSPC' })).kind).toBe('disk-full');
    expect(toSetupError(new Error('write /home/u/.ollama/models/blobs/sha256-e7: no space left on device')).kind).toBe('disk-full');
    expect(toSetupError(new Error('sdkmanager saiu com código 1: java.io.IOException: No space left on device')).kind).toBe('disk-full');
  });
  it('falhas de rede viram network', () => {
    expect(toSetupError(new TypeError('fetch failed')).kind).toBe('network');
    expect(toSetupError(Object.assign(new Error('x'), { code: 'ECONNRESET' })).kind).toBe('network');
    expect(toSetupError(Object.assign(new Error('x'), { code: 'ENOTFOUND' })).kind).toBe('network');
  });
  it('SetupError passa como está; o resto vira process com a mensagem cortada', () => {
    const e = new SetupError('checksum', 'não bate');
    expect(toSetupError(e)).toBe(e);
    const p = toSetupError(new Error('x'.repeat(500)));
    expect(p.kind).toBe('process');
    expect(p.message.length).toBeLessThanOrEqual(300);
  });
});
```

`electron/setup/paths.test.ts`:

```ts
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveSetupPaths } from './paths';

describe('resolveSetupPaths', () => {
  it('padrões dentro de ~/.local/share/enxame e ~/Android/Sdk', () => {
    const p = resolveSetupPaths({}, '/home/u');
    expect(p.dataDir).toBe('/home/u/.local/share/enxame');
    expect(p.setupFile).toBe('/home/u/.local/share/enxame/setup.json');
    expect(p.sdkRoot).toBe(path.join('/home/u', 'Android', 'Sdk'));
    expect(p.jreDir).toBe('/home/u/.local/share/enxame/tools/jre');
    expect(p.ollamaBin).toBe('/home/u/.local/share/enxame/tools/ollama/bin/ollama');
    expect(p.ollamaModels).toBe('/home/u/.ollama/models');
  });
  it('ENXAME_DATA_DIR, ANDROID_HOME e OLLAMA_MODELS mudam os lugares; sdkRoot salvo vence', () => {
    const p = resolveSetupPaths({ ENXAME_DATA_DIR: '/d', ANDROID_HOME: '/sdk', OLLAMA_MODELS: '/m' }, '/home/u');
    expect(p.setupFile).toBe('/d/setup.json');
    expect(p.sdkRoot).toBe('/sdk');
    expect(p.ollamaModels).toBe('/m');
    expect(resolveSetupPaths({ ANDROID_HOME: '/sdk' }, '/home/u', '/saved').sdkRoot).toBe('/saved');
  });
});
```

`electron/setup/setup-file.test.ts`:

```ts
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSetupFile, readSetupFileSync, writeSetupFile } from './setup-file';

const data = { version: 1 as const, completedAt: '2026-09-27T12:00:00.000Z', paths: { sdkRoot: '/sdk', ollamaBin: null } };

describe('setup.json', () => {
  it('grava e lê de volta; cria o diretório', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'enxame-setup-'));
    const file = path.join(dir, 'sub', 'setup.json');
    await writeSetupFile(file, data);
    expect(await readSetupFile(file)).toEqual(data);
    expect(readSetupFileSync(file)).toEqual(data);
    expect(JSON.parse(await readFile(file, 'utf8')).version).toBe(1);
  });
  it('ausente ou inválido devolve null', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'enxame-setup-'));
    expect(await readSetupFile(path.join(dir, 'nada.json'))).toBeNull();
    await writeFile(path.join(dir, 'ruim.json'), '{"version":2}');
    expect(await readSetupFile(path.join(dir, 'ruim.json'))).toBeNull();
    expect(readSetupFileSync(path.join(dir, 'nada.json'))).toBeNull();
  });
  it('recusa gravar formato errado', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'enxame-setup-'));
    await expect(writeSetupFile(path.join(dir, 's.json'), { ...data, paths: { sdkRoot: '', ollamaBin: null } })).rejects.toThrow();
  });
});
```

`electron/setup/requests.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AnthropicKeySchema, FinishRequestSchema, InstallRequestSchema } from './requests';

const KEY = 'sk-ant-' + 'x'.repeat(30);

describe('schemas do IPC de setup', () => {
  it('install aceita jobs conhecidos e nome de modelo do Ollama', () => {
    expect(InstallRequestSchema.parse({ jobs: ['img', 'model'], localModel: 'gpt-oss:20b' })).toEqual({ jobs: ['img', 'model'], localModel: 'gpt-oss:20b' });
  });
  it('install recusa job desconhecido, modelo com espaço ou barra, e campo a mais', () => {
    expect(() => InstallRequestSchema.parse({ jobs: ['rm -rf'], localModel: 'gpt-oss:20b' })).toThrow();
    expect(() => InstallRequestSchema.parse({ jobs: [], localModel: 'gpt oss' })).toThrow();
    expect(() => InstallRequestSchema.parse({ jobs: [], localModel: '../x' })).toThrow();
    expect(() => InstallRequestSchema.parse({ jobs: [], localModel: 'qwen3:14b', x: 1 })).toThrow();
  });
  it('finish aceita chave nula e recusa chave malformada', () => {
    expect(FinishRequestSchema.parse({ mode: 'nuvem', localModel: 'gpt-oss:20b', anthropicKey: null }).anthropicKey).toBeNull();
    expect(FinishRequestSchema.parse({ mode: 'misto', localModel: 'gpt-oss:20b', anthropicKey: ` ${KEY} ` }).anthropicKey).toBe(KEY);
    expect(() => FinishRequestSchema.parse({ mode: 'misto', localModel: 'gpt-oss:20b', anthropicKey: 'abc' })).toThrow();
    expect(() => FinishRequestSchema.parse({ mode: 'tudo', localModel: 'gpt-oss:20b', anthropicKey: null })).toThrow();
  });
  it('chave sozinha (Testar chave)', () => {
    expect(AnthropicKeySchema.parse(KEY)).toBe(KEY);
    expect(() => AnthropicKeySchema.parse('sk-ant-curta')).toThrow();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --project electron electron/setup`
Expected: FAIL — módulos não existem.

- [ ] **Step 3: Implementar**

`electron/setup/types.ts`:

```ts
/** DTOs do onboarding trocados com o renderer. O renderer valida o mesmo formato em src/onboarding/schema.ts. */
export type DepId = 'node' | 'sdk' | 'adb' | 'emu' | 'img' | 'kvm' | 'ollama' | 'keyring';
export type DepState = 'ok' | 'todo' | 'user';
/** O que a pessoa precisa fazer quando não dá para instalar sozinho. */
export type UserFix = 'node-missing' | 'kvm-group' | 'kvm-bios' | 'keyring-locked';
export interface DepStatus {
  readonly id: DepId; readonly state: DepState;
  readonly version: string | null;
  /** Download estimado em MB (só em `todo`). */
  readonly sizeMb: number | null;
  readonly fix: UserFix | null;
}
export interface Hardware {
  readonly ramGiB: number; readonly threads: number; readonly cpuModel: string;
  readonly gpu: { readonly name: string; readonly totalGiB: number } | null;
  readonly diskFreeGiB: number;
}
export interface SetupReport {
  readonly deps: readonly DepStatus[]; readonly hardware: Hardware;
  /** Modelos do Ollama já no disco, `nome:tag`. */
  readonly localModels: readonly string[];
}
export type JobId = 'sdk' | 'adb' | 'emu' | 'img' | 'ollama' | 'model';
/** Ordem de instalação: o sdkmanager vem antes dos pacotes; o Ollama antes do modelo. */
export const JOB_ORDER: readonly JobId[] = ['sdk', 'adb', 'emu', 'img', 'ollama', 'model'];
export type JobState = 'wait' | 'run' | 'done' | 'err';
export interface JobEvent {
  readonly id: JobId; readonly state: JobState; readonly doneMb: number; readonly totalMb: number;
  readonly error: { readonly kind: 'disk-full' | 'network' | 'checksum' | 'process'; readonly message: string } | null;
}
export type SetupMode = 'misto' | 'local' | 'nuvem';
```

`electron/setup/errors.ts`:

```ts
export type SetupErrorKind = 'disk-full' | 'network' | 'checksum' | 'process';

/** Erro de instalação com o tipo que a tela usa para escolher a mensagem e a ação. */
export class SetupError extends Error {
  readonly kind: SetupErrorKind;
  constructor(kind: SetupErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.kind = kind;
  }
}

const NETWORK_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_SOCKET']);

/** Classifica qualquer erro: disco cheio e rede primeiro (valem para download, tar, sdkmanager e Ollama). */
export function toSetupError(e: unknown): SetupError {
  if (e instanceof SetupError) return e;
  const code = (e as { code?: string } | null)?.code;
  const msg = String((e as Error | null)?.message ?? e);
  if (code === 'ENOSPC' || /no space left on device/i.test(msg)) return new SetupError('disk-full', 'sem espaço em disco', { cause: e });
  if ((code && NETWORK_CODES.has(code)) || /fetch failed|network|socket hang up/i.test(msg)) return new SetupError('network', msg.slice(0, 300), { cause: e });
  return new SetupError('process', msg.slice(0, 300), { cause: e });
}
```

`electron/setup/paths.ts`:

```ts
import os from 'node:os';
import path from 'node:path';

/** Onde o onboarding lê e instala. Tudo no home da pessoa: nada pede sudo. */
export interface SetupPaths {
  readonly dataDir: string; readonly setupFile: string;
  readonly sdkRoot: string;
  readonly toolsDir: string; readonly jreDir: string; readonly downloadsDir: string;
  readonly ollamaDir: string; readonly ollamaBin: string; readonly ollamaModels: string;
}

/** Mesmas regras do daemon (daemon/src/config.ts: sdkRootFrom); `savedSdkRoot` vem de um setup.json anterior. */
export function resolveSetupPaths(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir(), savedSdkRoot: string | null = null): SetupPaths {
  const dataDir = env.ENXAME_DATA_DIR || path.join(home, '.local', 'share', 'enxame');
  const toolsDir = path.join(dataDir, 'tools');
  const ollamaDir = path.join(toolsDir, 'ollama');
  return {
    dataDir,
    setupFile: path.join(dataDir, 'setup.json'),
    sdkRoot: savedSdkRoot || env.ANDROID_HOME || env.ANDROID_SDK_ROOT || path.join(home, 'Android', 'Sdk'),
    toolsDir,
    jreDir: path.join(toolsDir, 'jre'),
    downloadsDir: path.join(toolsDir, 'downloads'),
    ollamaDir,
    ollamaBin: path.join(ollamaDir, 'bin', 'ollama'),
    ollamaModels: env.OLLAMA_MODELS || path.join(home, '.ollama', 'models'),
  };
}
```

`electron/setup/setup-file.ts`:

```ts
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
  } catch { return null; }
}

/** Versão síncrona para a subida do main: os canais IPC precisam existir antes de a janela chamar `setup.status()`. */
export function readSetupFileSync(file: string): SetupFileT | null {
  try {
    const parsed = SetupFileSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

/** Gravação atômica (tmp + rename): o daemon nunca lê um arquivo pela metade. */
export async function writeSetupFile(file: string, data: SetupFileT): Promise<void> {
  const valid = SetupFileSchema.parse(data);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(valid, null, 2));
  await rename(tmp, file);
}
```

`electron/setup/requests.ts`:

```ts
import { z } from 'zod';
import { JOB_ORDER, type JobId } from './types.js';

/** Nome de modelo do Ollama: `nome` ou `nome:tag`, sem barra nem espaço (vira caminho de manifesto e corpo de /api/pull). */
const ModelName = z.string().max(120).regex(/^[a-z0-9][a-z0-9._-]*(?::[a-z0-9._-]+)?$/i, 'nome de modelo inválido');
export const AnthropicKeySchema = z.string().trim().min(20, 'chave curta demais').max(300, 'chave longa demais').startsWith('sk-ant-', 'a chave da Anthropic começa com sk-ant-');

export const InstallRequestSchema = z.object({
  jobs: z.array(z.enum(JOB_ORDER as [JobId, ...JobId[]])).max(JOB_ORDER.length),
  localModel: ModelName,
}).strict();
export type InstallRequest = z.infer<typeof InstallRequestSchema>;

export const FinishRequestSchema = z.object({
  mode: z.enum(['misto', 'local', 'nuvem']),
  localModel: ModelName,
  anthropicKey: AnthropicKeySchema.nullable(),
}).strict();
export type FinishRequest = z.infer<typeof FinishRequestSchema>;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run --project electron electron/setup`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/setup
git commit -m "feat(onboarding): base do setup no main (tipos, erros, caminhos, setup.json)"
```

---

### Task 4: Detecção das dependências e do hardware

**Files:**
- Create: `electron/setup/probe.ts`, `electron/setup/hardware.ts`
- Test: `electron/setup/probe.test.ts`, `electron/setup/hardware.test.ts`

**Interfaces:**
- Consumes: `SetupPaths` (Task 3), `DepStatus`, `Hardware`, `SetupReport` (Task 3).
- Produces: `interface ProbeDeps { exists; canReadWrite; readText; exec; listDir; keyringOk }`, `nodeProbeDeps(): ProbeDeps`, `interface ProbeResult { report: SetupReport; ollamaBin: string | null }`, `probeSetup(paths, probeDeps, hwDeps): Promise<ProbeResult>`, `SIZES_MB`, `SYSTEM_IMAGE`, `parseSourceProperties`, `nodeMajor`, `parseOllamaVersion`, `listLocalModels`; `interface HardwareDeps`, `nodeHardwareDeps()`, `readHardware(home, deps): Promise<Hardware>`, `parseNvidiaGpu`.

- [ ] **Step 1: Escrever os testes que falham**

`electron/setup/probe.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveSetupPaths } from './paths';
import { listLocalModels, nodeMajor, parseOllamaVersion, parseSourceProperties, probeDeps, type ProbeDeps } from './probe';

const paths = resolveSetupPaths({}, '/home/u');
const SDK = paths.sdkRoot;
const IMG = `${SDK}/system-images/android-34/google_apis_playstore/x86_64`;

function fake(o: { files?: string[]; rw?: string[]; texts?: Record<string, string>; exec?: Record<string, string>; dirs?: Record<string, string[]>; keyring?: boolean }): ProbeDeps {
  const files = new Set(o.files ?? []);
  return {
    exists: async (p) => files.has(p),
    canReadWrite: async (p) => (o.rw ?? []).includes(p),
    readText: async (p) => o.texts?.[p] ?? null,
    exec: async (cmd, args) => o.exec?.[`${cmd} ${args.join(' ')}`] ?? null,
    listDir: async (p) => o.dirs?.[p] ?? [],
    keyringOk: async () => o.keyring ?? true,
  };
}

const allInstalled = fake({
  files: [`${SDK}/cmdline-tools/latest/bin/sdkmanager`, `${SDK}/platform-tools/adb`, `${SDK}/emulator/emulator`, `${IMG}/system.img`, '/dev/kvm'],
  rw: ['/dev/kvm'],
  texts: {
    [`${SDK}/cmdline-tools/latest/source.properties`]: 'Pkg.Revision=19.0\n',
    [`${SDK}/platform-tools/source.properties`]: 'Pkg.UserSrc=false\nPkg.Revision=37.0.0\n',
    [`${SDK}/emulator/source.properties`]: 'Pkg.Revision=35.3.11\n',
    [`${IMG}/source.properties`]: 'Pkg.Revision=14\n',
  },
  exec: { 'node --version': 'v26.0.0\n', 'ollama --version': 'Warning: could not connect to a running Ollama instance\nWarning: client version is 0.12.3\n' },
  dirs: { '/home/u/.ollama/models/manifests/registry.ollama.ai/library': ['gpt-oss'], '/home/u/.ollama/models/manifests/registry.ollama.ai/library/gpt-oss': ['20b'] },
});

describe('parsers', () => {
  it('source.properties, node e ollama', () => {
    expect(parseSourceProperties('Pkg.UserSrc=false\nPkg.Revision=37.0.0\n')).toBe('37.0.0');
    expect(parseSourceProperties('nada')).toBeNull();
    expect(nodeMajor('v26.0.0\n')).toBe(26);
    expect(nodeMajor(null)).toBeNull();
    expect(parseOllamaVersion('ollama version is 0.34.4')).toBe('0.34.4');
    expect(parseOllamaVersion(null)).toBeNull();
  });
});

describe('probeDeps', () => {
  it('máquina já usada: tudo ok, com versões, e o Ollama do PATH', async () => {
    const r = await probeDeps(paths, allInstalled);
    expect(r.deps.map((d) => [d.id, d.state, d.version])).toEqual([
      ['node', 'ok', '26.0.0'], ['sdk', 'ok', '19.0'], ['adb', 'ok', '37.0.0'], ['emu', 'ok', '35.3.11'],
      ['img', 'ok', '14'], ['kvm', 'ok', '/dev/kvm'], ['ollama', 'ok', '0.12.3'], ['keyring', 'ok', null],
    ]);
    expect(r.ollamaBin).toBe('ollama');
    expect(r.localModels).toEqual(['gpt-oss:20b']);
  });
  it('máquina limpa: SDK e Ollama para instalar com tamanho; Node velho, KVM sem grupo e chaveiro trancado pedem a pessoa', async () => {
    const r = await probeDeps(paths, fake({ files: ['/dev/kvm'], exec: { 'node --version': 'v20.18.0' }, keyring: false }));
    const by = Object.fromEntries(r.deps.map((d) => [d.id, d]));
    expect(by.node).toMatchObject({ state: 'user', fix: 'node-missing' });
    expect(by.sdk).toMatchObject({ state: 'todo', sizeMb: 228 });
    expect(by.img).toMatchObject({ state: 'todo', sizeMb: 1600 });
    expect(by.kvm).toMatchObject({ state: 'user', fix: 'kvm-group' });
    expect(by.ollama).toMatchObject({ state: 'todo', sizeMb: 1428 });
    expect(by.keyring).toMatchObject({ state: 'user', fix: 'keyring-locked' });
    expect(r.ollamaBin).toBeNull();
  });
  it('sem /dev/kvm: virtualização desligada na BIOS', async () => {
    const r = await probeDeps(paths, fake({}));
    expect(r.deps.find((d) => d.id === 'kvm')).toMatchObject({ state: 'user', fix: 'kvm-bios' });
  });
  it('Ollama instalado pelo Enxame tem preferência sobre o do PATH', async () => {
    const r = await probeDeps(paths, fake({ exec: { [`${paths.ollamaBin} --version`]: 'ollama version is 0.34.4', 'ollama --version': 'ollama version is 0.12.3' } }));
    expect(r.ollamaBin).toBe(paths.ollamaBin);
    expect(r.deps.find((d) => d.id === 'ollama')?.version).toBe('0.34.4');
  });
});

describe('listLocalModels', () => {
  it('nome:tag de cada manifesto, ordenado; diretório ausente = nenhum', async () => {
    const lib = '/m/manifests/registry.ollama.ai/library';
    const d = fake({ dirs: { [lib]: ['qwen3', 'gpt-oss'], [`${lib}/qwen3`]: ['14b', '32b'], [`${lib}/gpt-oss`]: ['20b'] } });
    expect(await listLocalModels('/m', d)).toEqual(['gpt-oss:20b', 'qwen3:14b', 'qwen3:32b']);
    expect(await listLocalModels('/vazio', d)).toEqual([]);
  });
});
```

`electron/setup/hardware.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseNvidiaGpu, readHardware } from './hardware';

describe('parseNvidiaGpu', () => {
  it('nome sem o prefixo da marca e memória em GiB', () => {
    expect(parseNvidiaGpu('NVIDIA GeForce RTX 4090, 24564\n')).toEqual({ name: 'RTX 4090', totalGiB: 24 });
  });
  it('sem nvidia-smi ou saída estranha: null', () => {
    expect(parseNvidiaGpu(null)).toBeNull();
    expect(parseNvidiaGpu('')).toBeNull();
    expect(parseNvidiaGpu('No devices were found')).toBeNull();
  });
});

describe('readHardware', () => {
  it('junta RAM, threads, modelo da CPU, GPU e disco livre do home', async () => {
    const hw = await readHardware('/home/u', {
      totalMemBytes: () => 64 * 2 ** 30,
      cpus: () => Array.from({ length: 32 }, () => ({ model: ' AMD Ryzen 9 7950X 16-Core Processor ' })),
      exec: async () => 'NVIDIA GeForce RTX 4090, 24564',
      freeDiskBytes: async (p) => (p === '/home/u' ? 412 * 2 ** 30 : 0),
    });
    expect(hw).toEqual({ ramGiB: 64, threads: 32, cpuModel: 'AMD Ryzen 9 7950X 16-Core Processor', gpu: { name: 'RTX 4090', totalGiB: 24 }, diskFreeGiB: 412 });
  });
  it('máquina sem GPU NVIDIA e disco ilegível não quebram', async () => {
    const hw = await readHardware('/home/u', {
      totalMemBytes: () => 16 * 2 ** 30, cpus: () => [], exec: async () => null,
      freeDiskBytes: async () => { throw new Error('EACCES'); },
    });
    expect(hw).toEqual({ ramGiB: 16, threads: 0, cpuModel: '?', gpu: null, diskFreeGiB: 0 });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --project electron electron/setup/probe.test.ts electron/setup/hardware.test.ts`
Expected: FAIL — módulos não existem.

- [ ] **Step 3: Implementar `electron/setup/hardware.ts`**

```ts
import { execFile } from 'node:child_process';
import { statfs } from 'node:fs/promises';
import os from 'node:os';
import type { Hardware } from './types.js';

export interface HardwareDeps {
  readonly totalMemBytes: () => number;
  readonly cpus: () => readonly { readonly model: string }[];
  /** stdout, ou null se o comando não existe ou falhou. */
  readonly exec: (cmd: string, args: readonly string[]) => Promise<string | null>;
  readonly freeDiskBytes: (dir: string) => Promise<number>;
}

const GiB = 2 ** 30;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** `nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits` → primeira GPU. */
export function parseNvidiaGpu(out: string | null): Hardware['gpu'] {
  const line = out?.split('\n').map((s) => s.trim()).find(Boolean);
  if (!line) return null;
  const [name, mib] = line.split(',').map((s) => s.trim());
  const n = Number(mib);
  if (!name || !Number.isFinite(n) || n <= 0) return null;
  return { name: name.replace(/^NVIDIA\s+(GeForce\s+)?/, ''), totalGiB: round1(n / 1024) };
}

export async function readHardware(home: string, d: HardwareDeps): Promise<Hardware> {
  const cpus = d.cpus();
  const [gpuOut, free] = await Promise.all([
    d.exec('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']),
    d.freeDiskBytes(home).catch(() => 0),
  ]);
  return {
    ramGiB: round1(d.totalMemBytes() / GiB),
    threads: cpus.length,
    cpuModel: cpus[0]?.model.trim() || '?',
    gpu: parseNvidiaGpu(gpuOut),
    diskFreeGiB: round1(free / GiB),
  };
}

export function execOrNull(cmd: string, args: readonly string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, [...args], { timeout: 5000 }, (err, stdout, stderr) => resolve(err ? null : `${stdout}\n${stderr}`));
  });
}

export function nodeHardwareDeps(): HardwareDeps {
  return {
    totalMemBytes: () => os.totalmem(),
    cpus: () => os.cpus(),
    exec: execOrNull,
    freeDiskBytes: async (dir) => { const s = await statfs(dir); return s.bavail * s.bsize; },
  };
}
```

- [ ] **Step 4: Implementar `electron/setup/probe.ts`**

```ts
import { access, constants, readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { execOrNull, readHardware, type HardwareDeps } from './hardware.js';
import type { SetupPaths } from './paths.js';
import type { DepId, DepStatus, SetupReport, UserFix } from './types.js';

export interface ProbeDeps {
  readonly exists: (p: string) => Promise<boolean>;
  readonly canReadWrite: (p: string) => Promise<boolean>;
  readonly readText: (p: string) => Promise<string | null>;
  /** stdout+stderr, ou null se o comando não existe ou falhou. */
  readonly exec: (cmd: string, args: readonly string[]) => Promise<string | null>;
  readonly listDir: (p: string) => Promise<readonly string[]>;
  readonly keyringOk: () => Promise<boolean>;
}
export interface ProbeResult { readonly report: SetupReport; readonly ollamaBin: string | null }

export const MIN_NODE = 24;
export const SYSTEM_IMAGE = 'system-images;android-34;google_apis_playstore;x86_64';
/** Download estimado de cada item (MB decimais): JRE 47 + cmdline-tools 181; Ollama v0.34.4 .tar.zst. */
export const SIZES_MB = { sdk: 228, adb: 14, emu: 380, img: 1600, ollama: 1428 } as const;

export const parseSourceProperties = (text: string): string | null => /^Pkg\.Revision=(.+)$/m.exec(text)?.[1].trim() ?? null;
export function nodeMajor(v: string | null): number | null {
  const m = /^v?(\d+)\./.exec(v?.trim() ?? '');
  return m ? Number(m[1]) : null;
}
export const parseOllamaVersion = (out: string | null): string | null => /(\d+\.\d+\.\d+)/.exec(out ?? '')?.[1] ?? null;

const ok = (id: DepId, version: string | null): DepStatus => ({ id, state: 'ok', version, sizeMb: null, fix: null });
const todo = (id: keyof typeof SIZES_MB): DepStatus => ({ id, state: 'todo', version: null, sizeMb: SIZES_MB[id], fix: null });
const user = (id: DepId, fix: UserFix): DepStatus => ({ id, state: 'user', version: null, sizeMb: null, fix });

async function sdkPackage(id: 'sdk' | 'adb' | 'emu' | 'img', bin: string, dir: string, d: ProbeDeps): Promise<DepStatus> {
  if (!(await d.exists(bin))) return todo(id);
  return ok(id, parseSourceProperties((await d.readText(path.join(dir, 'source.properties'))) ?? '') ?? '?');
}

async function probeKvm(d: ProbeDeps): Promise<DepStatus> {
  if (!(await d.exists('/dev/kvm'))) return user('kvm', 'kvm-bios');
  return (await d.canReadWrite('/dev/kvm')) ? ok('kvm', '/dev/kvm') : user('kvm', 'kvm-group');
}

/** O Ollama instalado pelo Enxame vem primeiro; senão o do PATH. */
async function findOllama(paths: SetupPaths, d: ProbeDeps): Promise<{ bin: string; version: string } | null> {
  for (const bin of [paths.ollamaBin, 'ollama']) {
    const version = parseOllamaVersion(await d.exec(bin, ['--version']));
    if (version) return { bin, version };
  }
  return null;
}

/** Manifestos em `<models>/manifests/registry.ollama.ai/library/<nome>/<tag>` (não precisa do servidor no ar). */
export async function listLocalModels(modelsDir: string, d: Pick<ProbeDeps, 'listDir'>): Promise<readonly string[]> {
  const lib = path.join(modelsDir, 'manifests', 'registry.ollama.ai', 'library');
  const names = await d.listDir(lib);
  const perName = await Promise.all(names.map(async (n) => (await d.listDir(path.join(lib, n))).map((tag) => `${n}:${tag}`)));
  return perName.flat().sort();
}

export async function probeDeps(paths: SetupPaths, d: ProbeDeps): Promise<{ deps: readonly DepStatus[]; ollamaBin: string | null; localModels: readonly string[] }> {
  const sdk = paths.sdkRoot;
  const img = path.join(sdk, 'system-images', 'android-34', 'google_apis_playstore', 'x86_64');
  const nodeOut = await d.exec('node', ['--version']);
  const major = nodeMajor(nodeOut);
  const node = major !== null && major >= MIN_NODE ? ok('node', nodeOut!.trim().replace(/^v/, '')) : user('node', 'node-missing');
  const [sdkS, adb, emu, sysImg, kvm, ollama, keyringOk, localModels] = await Promise.all([
    sdkPackage('sdk', path.join(sdk, 'cmdline-tools', 'latest', 'bin', 'sdkmanager'), path.join(sdk, 'cmdline-tools', 'latest'), d),
    sdkPackage('adb', path.join(sdk, 'platform-tools', 'adb'), path.join(sdk, 'platform-tools'), d),
    sdkPackage('emu', path.join(sdk, 'emulator', 'emulator'), path.join(sdk, 'emulator'), d),
    sdkPackage('img', path.join(img, 'system.img'), img, d),
    probeKvm(d),
    findOllama(paths, d),
    d.keyringOk(),
    listLocalModels(paths.ollamaModels, d),
  ]);
  const deps = [
    node, sdkS, adb, emu, sysImg, kvm,
    ollama ? ok('ollama', ollama.version) : todo('ollama'),
    keyringOk ? ok('keyring', null) : user('keyring', 'keyring-locked'),
  ];
  return { deps, ollamaBin: ollama?.bin ?? null, localModels };
}

export async function probeSetup(paths: SetupPaths, d: ProbeDeps, hw: HardwareDeps): Promise<ProbeResult> {
  const home = path.dirname(path.dirname(paths.ollamaModels)) || '/';
  const [p, hardware] = await Promise.all([probeDeps(paths, d), readHardware(home, hw)]);
  return { report: { deps: p.deps, hardware, localModels: p.localModels }, ollamaBin: p.ollamaBin };
}

/** Mesma entrada que o cofre do daemon usa (daemon/src/vault/keyring.ts), com outra conta: só testa se o Secret Service responde. */
function keyringProbe(): boolean {
  try {
    const { Entry } = createRequire(import.meta.url)('@napi-rs/keyring') as typeof import('@napi-rs/keyring');
    new Entry('enxame', 'setup-probe', { linux: { store: 'secret-service' } }).getPassword();
    return true;
  } catch { return false; }
}

export function nodeProbeDeps(): ProbeDeps {
  return {
    exists: (p) => access(p).then(() => true, () => false),
    canReadWrite: (p) => access(p, constants.R_OK | constants.W_OK).then(() => true, () => false),
    readText: (p) => readFile(p, 'utf8').catch(() => null),
    exec: execOrNull,
    listDir: (p) => readdir(p).catch(() => []),
    keyringOk: async () => keyringProbe(),
  };
}
```

Nota para quem implementa: `probeSetup` mede o disco livre no home. `path.dirname(path.dirname('/home/u/.ollama/models'))` = `/home/u`; se `OLLAMA_MODELS` apontar para outro disco, o número mostrado é o desse disco, que é onde o modelo vai cair (o maior download).

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run --project electron electron/setup`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/setup/probe.ts electron/setup/hardware.ts electron/setup/probe.test.ts electron/setup/hardware.test.ts
git commit -m "feat(onboarding): detecta dependências e hardware no main"
```

---

### Task 5: Download com retomada e processo com linhas

**Files:**
- Create: `electron/setup/download.ts`, `electron/setup/proc.ts`
- Test: `electron/setup/download.test.ts`, `electron/setup/proc.test.ts`

**Interfaces:**
- Consumes: `SetupError`, `toSetupError` (Task 3).
- Produces: `interface Checksum { algo: 'sha1' | 'sha256'; hex: string }`, `downloadResumable(o: { url; dest; checksum?: Checksum | null; onProgress?: (doneBytes: number, totalBytes: number | null) => void; fetch?: typeof fetch }): Promise<void>`; `runProcess(cmd, args, o?: { env?; stdin?; onLine? }, spawnFn?): Promise<void>`, `type SpawnFn`.

- [ ] **Step 1: Escrever os testes que falham**

`electron/setup/download.test.ts`:

```ts
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { downloadResumable } from './download';

const BODY = Buffer.from('0123456789abcdefghij'); // 20 bytes
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const tmp = () => mkdtemp(path.join(os.tmpdir(), 'enxame-dl-'));

describe('downloadResumable', () => {
  it('baixa, confere o checksum e renomeia o .part', async () => {
    const dir = await tmp(); const dest = path.join(dir, 'f.bin');
    const seen: number[] = [];
    await downloadResumable({
      url: 'https://x.test/f', dest, checksum: { algo: 'sha256', hex: sha256(BODY) },
      fetch: (async () => new Response(BODY, { status: 200, headers: { 'content-length': '20' } })) as unknown as typeof fetch,
      onProgress: (done, total) => { seen.push(done); expect(total).toBe(20); },
    });
    expect(await readFile(dest)).toEqual(BODY);
    expect(seen.at(-1)).toBe(20);
    await expect(stat(`${dest}.part`)).rejects.toThrow();
  });
  it('retoma do .part com Range e soma ao que já tinha', async () => {
    const dir = await tmp(); const dest = path.join(dir, 'f.bin');
    await writeFile(`${dest}.part`, BODY.subarray(0, 8));
    let range: string | null = null;
    await downloadResumable({
      url: 'https://x.test/f', dest, checksum: { algo: 'sha256', hex: sha256(BODY) },
      fetch: (async (_u: unknown, init?: { headers?: Record<string, string> }) => {
        range = init?.headers?.range ?? null;
        return new Response(BODY.subarray(8), { status: 206, headers: { 'content-range': 'bytes 8-19/20' } });
      }) as unknown as typeof fetch,
    });
    expect(range).toBe('bytes=8-');
    expect(await readFile(dest)).toEqual(BODY);
  });
  it('servidor que ignora Range (200) recomeça do zero sem duplicar bytes', async () => {
    const dir = await tmp(); const dest = path.join(dir, 'f.bin');
    await writeFile(`${dest}.part`, Buffer.from('lixo-antigo'));
    await downloadResumable({
      url: 'https://x.test/f', dest, checksum: { algo: 'sha256', hex: sha256(BODY) },
      fetch: (async () => new Response(BODY, { status: 200 })) as unknown as typeof fetch,
    });
    expect(await readFile(dest)).toEqual(BODY);
  });
  it('416 com .part completo: só confere e renomeia', async () => {
    const dir = await tmp(); const dest = path.join(dir, 'f.bin');
    await writeFile(`${dest}.part`, BODY);
    await downloadResumable({
      url: 'https://x.test/f', dest, checksum: { algo: 'sha256', hex: sha256(BODY) },
      fetch: (async () => new Response(null, { status: 416 })) as unknown as typeof fetch,
    });
    expect(await readFile(dest)).toEqual(BODY);
  });
  it('checksum errado: apaga o .part e lança checksum', async () => {
    const dir = await tmp(); const dest = path.join(dir, 'f.bin');
    await expect(downloadResumable({
      url: 'https://x.test/f', dest, checksum: { algo: 'sha1', hex: '0'.repeat(40) },
      fetch: (async () => new Response(BODY, { status: 200 })) as unknown as typeof fetch,
    })).rejects.toMatchObject({ kind: 'checksum' });
    await expect(stat(`${dest}.part`)).rejects.toThrow();
  });
  it('fetch que falha vira network; 404 também', async () => {
    const dir = await tmp(); const dest = path.join(dir, 'f.bin');
    await expect(downloadResumable({ url: 'https://x.test/f', dest, fetch: (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch }))
      .rejects.toMatchObject({ kind: 'network' });
    await expect(downloadResumable({ url: 'https://x.test/f', dest, fetch: (async () => new Response('não', { status: 404 })) as unknown as typeof fetch }))
      .rejects.toMatchObject({ kind: 'network' });
  });
});
```

`electron/setup/proc.test.ts`:

```ts
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { runProcess } from './proc';

function fakeChild(script: (c: { out: PassThrough; err: PassThrough; close: (code: number) => void; stdin: string[] }) => void) {
  const ev = new EventEmitter();
  const out = new PassThrough(); const err = new PassThrough();
  const stdinChunks: string[] = [];
  const stdin = new PassThrough();
  stdin.on('data', (b) => stdinChunks.push(String(b)));
  const child = Object.assign(ev, { stdout: out, stderr: err, stdin }) as unknown as ChildProcess;
  setTimeout(() => script({ out, err, close: (code) => ev.emit('close', code), stdin: stdinChunks }), 0);
  return { child, stdinChunks };
}

describe('runProcess', () => {
  it('repassa linhas de stdout e stderr, separando \\r e \\n', async () => {
    const lines: string[] = [];
    const { child } = fakeChild(({ out, err, close }) => { out.write('[===    ] 20% Downloading\r[=====  ] 54% Downloading\n'); err.write('aviso\n'); setTimeout(() => close(0), 5); });
    await runProcess('sdkmanager', ['--install', 'emulator'], { onLine: (l) => lines.push(l) }, () => child);
    expect(lines).toEqual(['[===    ] 20% Downloading', '[=====  ] 54% Downloading', 'aviso']);
  });
  it('escreve o stdin (aceitar licenças)', async () => {
    const { child, stdinChunks } = fakeChild(({ close }) => setTimeout(() => close(0), 5));
    await runProcess('sdkmanager', ['--licenses'], { stdin: 'y\ny\n' }, () => child);
    expect(stdinChunks.join('')).toBe('y\ny\n');
  });
  it('código diferente de zero vira erro com as últimas linhas; sem espaço vira disk-full', async () => {
    const a = fakeChild(({ out, close }) => { out.write('Error: falhou feio\n'); setTimeout(() => close(1), 5); });
    await expect(runProcess('/sdk/bin/sdkmanager', [], {}, () => a.child)).rejects.toMatchObject({ kind: 'process', message: expect.stringContaining('sdkmanager saiu com código 1: Error: falhou feio') });
    const b = fakeChild(({ err, close }) => { err.write('java.io.IOException: No space left on device\n'); setTimeout(() => close(1), 5); });
    await expect(runProcess('sdkmanager', [], {}, () => b.child)).rejects.toMatchObject({ kind: 'disk-full' });
  });
  it('comando inexistente (evento error) rejeita em vez de derrubar o main', async () => {
    const ev = new EventEmitter();
    const child = Object.assign(ev, { stdout: null, stderr: null, stdin: null }) as unknown as ChildProcess;
    setTimeout(() => ev.emit('error', Object.assign(new Error('spawn tar ENOENT'), { code: 'ENOENT' })), 0);
    await expect(runProcess('tar', [], {}, () => child)).rejects.toMatchObject({ kind: 'process' });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --project electron electron/setup/download.test.ts electron/setup/proc.test.ts`
Expected: FAIL — módulos não existem.

- [ ] **Step 3: Implementar `electron/setup/download.ts`**

```ts
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { SetupError, toSetupError } from './errors.js';

export interface Checksum { readonly algo: 'sha1' | 'sha256'; readonly hex: string }
export interface DownloadOpts {
  readonly url: string; readonly dest: string;
  readonly checksum?: Checksum | null;
  readonly onProgress?: (doneBytes: number, totalBytes: number | null) => void;
  readonly fetch?: typeof fetch;
}

const sizeOf = (p: string) => stat(p).then((s) => s.size, () => 0);
const hostOf = (url: string) => new URL(url).host;

/** `bytes 8-19/20` → 20. */
function totalFromRange(h: string | null): number | null {
  const m = /\/(\d+)$/.exec(h ?? '');
  return m ? Number(m[1]) : null;
}

async function hashFile(file: string, algo: Checksum['algo']): Promise<string> {
  const h = createHash(algo);
  await pipeline(createReadStream(file), h);
  return h.digest('hex');
}

/**
 * Baixa para `<dest>.part` e renomeia no fim. Com `.part` existente pede `Range` e continua (spec: "o download
 * continua de onde parou"); servidor que responde 200 recomeça do zero; 416 = já estava completo.
 */
export async function downloadResumable(o: DownloadOpts): Promise<void> {
  const fetchFn = o.fetch ?? fetch;
  const part = `${o.dest}.part`;
  await mkdir(path.dirname(o.dest), { recursive: true });
  const have = await sizeOf(part);
  let res: Response;
  try {
    res = await fetchFn(o.url, { headers: have > 0 ? { range: `bytes=${have}-` } : {} });
  } catch (e) {
    throw new SetupError('network', `sem conexão com ${hostOf(o.url)}`, { cause: e });
  }
  if (res.status !== 416) {
    if (!res.ok || !res.body) throw new SetupError('network', `${hostOf(o.url)} respondeu ${res.status}`);
    const append = res.status === 206;
    const start = append ? have : 0;
    const total = append ? totalFromRange(res.headers.get('content-range')) : Number(res.headers.get('content-length')) || null;
    let done = start;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) { done += chunk.length; o.onProgress?.(done, total); cb(null, chunk); },
    });
    try {
      await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), counter, createWriteStream(part, { flags: append ? 'a' : 'w' }));
    } catch (e) {
      throw toSetupError(e);
    }
  }
  if (o.checksum) {
    const got = await hashFile(part, o.checksum.algo);
    if (got !== o.checksum.hex.toLowerCase()) {
      await unlink(part).catch(() => undefined);
      throw new SetupError('checksum', `o arquivo de ${hostOf(o.url)} veio diferente do esperado`);
    }
  }
  await rename(part, o.dest);
}
```

- [ ] **Step 4: Implementar `electron/setup/proc.ts`**

```ts
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { toSetupError } from './errors.js';

export type SpawnFn = (cmd: string, args: readonly string[], opts: { env: NodeJS.ProcessEnv }) => ChildProcess;
export interface ProcOpts {
  readonly env?: NodeJS.ProcessEnv;
  /** Escrito no stdin e fechado (ex.: `y` para as licenças do sdkmanager). */
  readonly stdin?: string;
  readonly onLine?: (line: string) => void;
}

const defaultSpawn: SpawnFn = (cmd, args, opts) => spawn(cmd, [...args], { env: opts.env, stdio: ['pipe', 'pipe', 'pipe'] });

/** Roda até o fim; cada linha (separada por \r ou \n) vai para `onLine`. Código ≠ 0 rejeita com as últimas 5 linhas. */
export function runProcess(cmd: string, args: readonly string[], o: ProcOpts = {}, spawnFn: SpawnFn = defaultSpawn): Promise<void> {
  return new Promise((resolve, reject) => {
    let tail: readonly string[] = [];
    let child: ChildProcess;
    try { child = spawnFn(cmd, args, { env: o.env ?? process.env }); } catch (e) { reject(toSetupError(e)); return; }
    const onChunk = (buf: Buffer | string) => {
      for (const raw of String(buf).split(/[\r\n]+/)) {
        const line = raw.trim();
        if (!line) continue;
        tail = [...tail, line].slice(-5);
        o.onLine?.(line);
      }
    };
    child.stdout?.on('data', onChunk);
    child.stderr?.on('data', onChunk);
    child.on('error', (e) => reject(toSetupError(e)));
    child.on('close', (code: number | null) => {
      if (code === 0) resolve();
      else reject(toSetupError(new Error(`${path.basename(cmd)} saiu com código ${code}: ${tail.join(' | ')}`)));
    });
    child.stdin?.on('error', () => undefined); // processo que sai antes de ler o stdin (EPIPE)
    if (o.stdin) child.stdin?.write(o.stdin);
    child.stdin?.end();
  });
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run --project electron electron/setup`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/setup/download.ts electron/setup/proc.ts electron/setup/download.test.ts electron/setup/proc.test.ts
git commit -m "feat(onboarding): download com retomada e checksum; processo com linhas"
```

---

### Task 6: Instaladores (SDK, Ollama, modelo)

**Files:**
- Create: `electron/setup/ollama-pull.ts`, `electron/setup/runners.ts`
- Test: `electron/setup/ollama-pull.test.ts`, `electron/setup/runners.test.ts`
- Modify: `package.json` (dependência `extract-zip`)

**Interfaces:**
- Consumes: `SetupPaths`, `SetupError`, `toSetupError`, `JobId` (Task 3); `SIZES_MB`, `SYSTEM_IMAGE` (Task 4); `downloadResumable`, `Checksum`, `runProcess`, `ProcOpts` (Task 5).
- Produces:
  - `ollama-pull.ts`: `pullProgress(layers): { done: number; total: number }`, `ndjsonLines(body): AsyncGenerator<string>`, `interface PullDeps { fetch; spawn; sleep; log }`, `pullModel(model: string, bin: string, d: PullDeps, progress: (doneMb: number, totalMb: number) => void): Promise<void>`.
  - `runners.ts`: `type Progress = (doneMb: number, totalMb: number) => void`, `type JobRunner = (progress: Progress) => Promise<void>`, `type JobRunners = Readonly<Record<JobId, JobRunner>>`, `interface RunnerDeps`, `createRunners(localModel: string, ollamaBin: string, d: RunnerDeps): JobRunners`, `parseSdkPercent(line): number | null`, `JRE`, `CMDLINE_TOOLS`, `OLLAMA`, `nodeRunnerDeps(paths, log): RunnerDeps`.

- [ ] **Step 1: Instalar a dependência**

Run: `npm install extract-zip@^2.0.1`
Expected: `package.json` ganha `"extract-zip": "^2.0.1"` em `dependencies`.

- [ ] **Step 2: Escrever os testes que falham**

`electron/setup/ollama-pull.test.ts`:

```ts
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { ndjsonLines, pullModel, pullProgress, type PullDeps } from './ollama-pull';

const stream = (chunks: string[]) => new ReadableStream<Uint8Array>({
  start(c) { for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch)); c.close(); },
});

function deps(o: { alive: boolean[]; pull: () => Response }): PullDeps & { spawned: string[]; logs: string[]; killedCount: () => number } {
  const spawned: string[] = []; const logs: string[] = []; let killed = 0; let i = 0;
  return {
    fetch: (async (url: unknown) => {
      if (String(url).endsWith('/api/version')) { const up = o.alive[Math.min(i, o.alive.length - 1)]; i++; if (!up) throw new TypeError('fetch failed'); return new Response('{"version":"0.34.4"}'); }
      return o.pull();
    }) as unknown as typeof fetch,
    spawn: (cmd: string) => { spawned.push(cmd); const ev = new EventEmitter(); return Object.assign(ev, { kill: () => { killed++; return true; } }) as unknown as ChildProcess; },
    sleep: async () => {},
    log: (l: string) => logs.push(l),
    spawned, logs, killedCount: () => killed,
  };
}

describe('ndjsonLines', () => {
  it('junta linhas quebradas entre pedaços', async () => {
    const out: string[] = [];
    for await (const l of ndjsonLines(stream(['{"a":', '1}\n{"b":2}\n', '{"c":3}']))) out.push(l);
    expect(out).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });
});

describe('pullProgress', () => {
  it('soma as camadas', () => {
    expect(pullProgress(new Map([['a', { total: 100, completed: 50 }], ['b', { total: 10, completed: 10 }]]))).toEqual({ done: 60, total: 110 });
  });
});

describe('pullModel', () => {
  const lines = [
    '{"status":"pulling manifest"}',
    '{"status":"pulling e7b2","digest":"sha256:e7b2","total":13000000000,"completed":0}',
    '{"status":"pulling e7b2","digest":"sha256:e7b2","total":13000000000,"completed":6500000000}',
    '{"status":"success"}',
  ].join('\n');

  it('com Ollama no ar: não spawna, reporta MB e loga os status', async () => {
    const d = deps({ alive: [true], pull: () => new Response(stream([lines])) });
    const seen: [number, number][] = [];
    await pullModel('gpt-oss:20b', '/bin/ollama', d, (done, total) => seen.push([done, total]));
    expect(d.spawned).toEqual([]);
    expect(seen.at(-1)).toEqual([6500, 13000]);
    expect(d.logs).toContain('pulling manifest');
  });
  it('sem Ollama: sobe `serve` temporário, espera responder e derruba no fim', async () => {
    const d = deps({ alive: [false, false, true], pull: () => new Response(stream([lines])) });
    await pullModel('gpt-oss:20b', '/opt/ollama/bin/ollama', d, () => {});
    expect(d.spawned).toEqual(['/opt/ollama/bin/ollama']);
    expect(d.killedCount()).toBe(1);
  });
  it('erro de disco cheio no meio do pull vira disk-full e ainda derruba o serve', async () => {
    const d = deps({ alive: [false, true], pull: () => new Response(stream([
      '{"status":"pulling e7b2","digest":"sha256:e7b2","total":100,"completed":61}\n',
      '{"error":"write /home/u/.ollama/models/blobs/sha256-e7b2-partial: no space left on device"}\n',
    ])) });
    await expect(pullModel('gpt-oss:20b', 'ollama', d, () => {})).rejects.toMatchObject({ kind: 'disk-full' });
    expect(d.killedCount()).toBe(1);
  });
  it('modelo inexistente vira process com a mensagem do Ollama', async () => {
    const d = deps({ alive: [true], pull: () => new Response(stream(['{"error":"pull model manifest: file does not exist"}\n'])) });
    await expect(pullModel('naoexiste:1b', 'ollama', d, () => {})).rejects.toMatchObject({ kind: 'process', message: expect.stringContaining('file does not exist') });
  });
});
```

`electron/setup/runners.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SetupError } from './errors';
import { resolveSetupPaths } from './paths';
import { CMDLINE_TOOLS, createRunners, JRE, OLLAMA, parseSdkPercent, type RunnerDeps } from './runners';

const paths = resolveSetupPaths({}, '/home/u');

function deps(o: { runFails?: (cmd: string, args: readonly string[]) => Error | null; javaHere?: boolean } = {}) {
  const calls: string[] = [];
  const d: RunnerDeps = {
    paths,
    download: async (x) => { calls.push(`download ${x.url}`); x.onProgress?.(1_000_000, 2_000_000); },
    run: async (cmd, args, opts) => {
      calls.push(`run ${cmd.replace(paths.sdkRoot, '$SDK')} ${args.join(' ').replaceAll(paths.sdkRoot, '$SDK')}`);
      opts?.onLine?.('[=====     ] 50% Downloading');
      const err = o.runFails?.(cmd, args); if (err) throw err;
    },
    extractZip: async (zip, dir) => { calls.push(`unzip ${zip} ${dir}`); },
    fs: {
      rm: async (p) => { calls.push(`rm ${p}`); },
      mkdir: async () => undefined,
      rename: async (a, b) => { calls.push(`mv ${a} ${b}`); },
      chmod: async () => undefined,
      readdir: async () => ['sdkmanager', 'avdmanager'],
    },
    exists: async (p) => (o.javaHere ?? true) && p.endsWith('/jre/bin/java'),
    pull: async (model, bin, progress) => { calls.push(`pull ${model} ${bin}`); progress(10, 20); },
    log: () => undefined,
  };
  return { d, calls };
}

describe('parseSdkPercent', () => {
  it('lê a porcentagem da barra do sdkmanager', () => {
    expect(parseSdkPercent('[=======                                ] 20% Downloading x86_64-34_r14.zip')).toBe(20);
    expect(parseSdkPercent('[=======================================] 100% Unzipping...')).toBe(100);
    expect(parseSdkPercent('Loading package information...')).toBeNull();
  });
});

describe('createRunners', () => {
  it('sdk: baixa JRE e cmdline-tools, extrai, move para cmdline-tools/latest e aceita licenças', async () => {
    const { d, calls } = deps();
    const seen: [number, number][] = [];
    await createRunners('gpt-oss:20b', 'ollama', d).sdk((a, b) => seen.push([a, b]));
    expect(calls).toContain(`download ${JRE.url}`);
    expect(calls).toContain(`download ${CMDLINE_TOOLS.url}`);
    expect(calls.some((c) => c.startsWith('run tar -xzf'))).toBe(true);
    expect(calls).toContain(`mv ${paths.downloadsDir}/cmdline-tools-unzip/cmdline-tools ${paths.sdkRoot}/cmdline-tools/latest`);
    expect(calls).toContain('run $SDK/cmdline-tools/latest/bin/sdkmanager --sdk_root=$SDK --licenses');
    expect(seen.at(-1)).toEqual([JRE.sizeMb + CMDLINE_TOOLS.sizeMb, JRE.sizeMb + CMDLINE_TOOLS.sizeMb]);
  });
  it('img: sdkmanager --install da imagem, progresso pela barra', async () => {
    const { d, calls } = deps();
    const seen: [number, number][] = [];
    await createRunners('gpt-oss:20b', 'ollama', d).img((a, b) => seen.push([a, b]));
    expect(calls).toContain('run $SDK/cmdline-tools/latest/bin/sdkmanager --sdk_root=$SDK --install system-images;android-34;google_apis_playstore;x86_64');
    expect(seen).toContainEqual([800, 1600]);
    expect(seen.at(-1)).toEqual([1600, 1600]);
  });
  it('ollama: baixa o .tar.zst fixado, extrai com --zstd e apaga o arquivo', async () => {
    const { d, calls } = deps();
    await createRunners('gpt-oss:20b', 'ollama', d).ollama(() => {});
    expect(calls).toContain(`download ${OLLAMA.url}`);
    expect(calls).toContain(`run tar --zstd -xf ${paths.downloadsDir}/ollama-linux-amd64.tar.zst -C ${paths.ollamaDir}`);
    expect(calls).toContain(`rm ${paths.downloadsDir}/ollama-linux-amd64.tar.zst`);
  });
  it('ollama: tar sem zstd vira mensagem com o apt install', async () => {
    const { d } = deps({ runFails: (cmd) => (cmd === 'tar' ? new Error('tar saiu com código 2: tar (child): zstd: Cannot exec: No such file or directory') : null) });
    await expect(createRunners('gpt-oss:20b', 'ollama', d).ollama(() => {})).rejects.toSatisfy((e: SetupError) => e.kind === 'process' && e.message.includes('sudo apt install zstd'));
  });
  it('model: puxa o modelo escolhido com o binário informado', async () => {
    const { d, calls } = deps();
    await createRunners('qwen3:14b', '/opt/ollama', d).model(() => {});
    expect(calls).toContain('pull qwen3:14b /opt/ollama');
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run --project electron electron/setup/ollama-pull.test.ts electron/setup/runners.test.ts`
Expected: FAIL — módulos não existem.

- [ ] **Step 4: Implementar `electron/setup/ollama-pull.ts`**

```ts
import { spawn, type ChildProcess } from 'node:child_process';
import { SetupError, toSetupError } from './errors.js';

const BASE = 'http://127.0.0.1:11434';
const WAIT_TRIES = 80; // 80 × 250 ms = 20 s, igual ao supervisor do daemon

export interface PullDeps {
  readonly fetch: typeof fetch;
  readonly spawn: (cmd: string, args: readonly string[], opts: { env: NodeJS.ProcessEnv }) => ChildProcess;
  readonly sleep: (ms: number) => Promise<void>;
  readonly log: (line: string) => void;
}
interface Layer { readonly total: number; readonly completed: number }

export function pullProgress(layers: ReadonlyMap<string, Layer>): { done: number; total: number } {
  let done = 0; let total = 0;
  for (const l of layers.values()) { done += l.completed; total += l.total; }
  return { done, total };
}

export async function* ndjsonLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    const parts = buf.split('\n');
    buf = parts.pop() ?? '';
    for (const p of parts) if (p.trim()) yield p.trim();
  }
  if (buf.trim()) yield buf.trim();
}

const alive = (fetchFn: typeof fetch) => fetchFn(`${BASE}/api/version`).then((r) => r.ok, () => false);

/**
 * Usa o Ollama que já estiver no ar; senão sobe um `serve` só para o pull e derruba no fim. O daemon depois sobe o
 * dele com o contexto certo (daemon/src/provider/ollama.ts), então este não pode ficar vivo.
 */
async function withServer<T>(bin: string, d: PullDeps, fn: () => Promise<T>): Promise<T> {
  if (await alive(d.fetch)) return fn();
  const child = d.spawn(bin, ['serve'], { env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11434' } });
  let spawnErr: unknown = null;
  child.on('error', (e) => { spawnErr = e; });
  try {
    for (let i = 0; i < WAIT_TRIES; i++) {
      if (spawnErr) throw toSetupError(spawnErr);
      if (await alive(d.fetch)) return await fn();
      await d.sleep(250);
    }
    throw new SetupError('process', 'o Ollama não respondeu em 20 s');
  } finally {
    child.kill('SIGTERM');
  }
}

interface PullLine { readonly status?: string; readonly digest?: string; readonly total?: number; readonly completed?: number; readonly error?: string }

export async function pullModel(model: string, bin: string, d: PullDeps, progress: (doneMb: number, totalMb: number) => void): Promise<void> {
  await withServer(bin, d, async () => {
    let res: Response;
    try {
      res = await d.fetch(`${BASE}/api/pull`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, stream: true }) });
    } catch (e) { throw toSetupError(e); }
    if (!res.ok || !res.body) throw new SetupError('network', `o Ollama respondeu ${res.status} ao baixar ${model}`);
    let layers: ReadonlyMap<string, Layer> = new Map();
    for await (const line of ndjsonLines(res.body)) {
      let msg: PullLine;
      try { msg = JSON.parse(line) as PullLine; } catch { continue; }
      if (msg.error) throw toSetupError(new Error(msg.error));
      if (msg.digest && typeof msg.total === 'number') {
        layers = new Map(layers).set(msg.digest, { total: msg.total, completed: msg.completed ?? 0 });
        const p = pullProgress(layers);
        progress(p.done / 1e6, p.total / 1e6);
      } else if (msg.status) {
        d.log(msg.status);
      }
    }
  });
}

export function nodePullDeps(log: (line: string) => void): PullDeps {
  return {
    fetch,
    spawn: (cmd, args, opts) => spawn(cmd, [...args], { env: opts.env, stdio: 'ignore' }),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log,
  };
}
```

- [ ] **Step 5: Implementar `electron/setup/runners.ts`**

```ts
import { chmod, mkdir, readdir, rename, rm } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import path from 'node:path';
import extractZip from 'extract-zip';
import { downloadResumable, type Checksum, type DownloadOpts } from './download.js';
import { SetupError } from './errors.js';
import { nodePullDeps, pullModel } from './ollama-pull.js';
import type { SetupPaths } from './paths.js';
import { SIZES_MB, SYSTEM_IMAGE } from './probe.js';
import { runProcess, type ProcOpts } from './proc.js';
import type { JobId } from './types.js';

export type Progress = (doneMb: number, totalMb: number) => void;
export type JobRunner = (progress: Progress) => Promise<void>;
export type JobRunners = Readonly<Record<JobId, JobRunner>>;

interface Pinned { readonly url: string; readonly checksum: Checksum; readonly sizeMb: number }
/** Versões fixadas (spec onboarding §Arquitetura). Para atualizar: nova URL, novo checksum da fonte oficial, novo tamanho. */
export const JRE: Pinned = {
  url: 'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.20.1%2B1/OpenJDK17U-jre_x64_linux_hotspot_17.0.20.1_1.tar.gz',
  checksum: { algo: 'sha256', hex: '0b2b640e3046b64c8ec504de0ab9d91bb5610182bda21fad454681ce54d45a62' }, sizeMb: 47,
};
export const CMDLINE_TOOLS: Pinned = {
  url: 'https://dl.google.com/android/repository/commandlinetools-linux-16111833_latest.zip',
  checksum: { algo: 'sha1', hex: 'e025545c62a8e64c7559119566a569fb1dec5f60' }, sizeMb: 181,
};
export const OLLAMA: Pinned = {
  url: 'https://github.com/ollama/ollama/releases/download/v0.34.4/ollama-linux-amd64.tar.zst',
  checksum: { algo: 'sha256', hex: 'c238986e61d40c0cc5f4a9b9e40b9eea104350b77efa34741fc134e105cb9533' }, sizeMb: SIZES_MB.ollama,
};

export interface RunnerDeps {
  readonly paths: SetupPaths;
  readonly download: (o: DownloadOpts) => Promise<void>;
  readonly run: (cmd: string, args: readonly string[], o?: ProcOpts) => Promise<void>;
  readonly extractZip: (zip: string, dir: string) => Promise<void>;
  readonly fs: {
    readonly rm: (p: string, o: { recursive: true; force: true }) => Promise<void>;
    readonly mkdir: (p: string, o: { recursive: true }) => Promise<unknown>;
    readonly rename: (a: string, b: string) => Promise<void>;
    readonly chmod: (p: string, mode: number) => Promise<void>;
    readonly readdir: (p: string) => Promise<readonly string[]>;
  };
  readonly exists: (p: string) => Promise<boolean>;
  readonly pull: (model: string, bin: string, progress: Progress) => Promise<void>;
  readonly log: (line: string) => void;
}

const toMb = (bytes: number) => bytes / 1e6;

export function parseSdkPercent(line: string): number | null {
  const m = /\]\s*(\d{1,3})%/.exec(line);
  return m ? Math.min(100, Number(m[1])) : null;
}

const sdkmanager = (d: RunnerDeps) => path.join(d.paths.sdkRoot, 'cmdline-tools', 'latest', 'bin', 'sdkmanager');

/** JAVA_HOME no JRE do Enxame quando ele existe; senão o Java que a pessoa já tem. */
async function sdkEnv(d: RunnerDeps): Promise<NodeJS.ProcessEnv> {
  if (!(await d.exists(path.join(d.paths.jreDir, 'bin', 'java')))) return process.env;
  return { ...process.env, JAVA_HOME: d.paths.jreDir, PATH: `${path.join(d.paths.jreDir, 'bin')}:${process.env.PATH ?? ''}` };
}

async function installCmdlineTools(d: RunnerDeps, progress: Progress): Promise<void> {
  const total = JRE.sizeMb + CMDLINE_TOOLS.sizeMb;
  const dl = d.paths.downloadsDir;
  const jreFile = path.join(dl, 'jre.tar.gz');
  await d.download({ url: JRE.url, dest: jreFile, checksum: JRE.checksum, onProgress: (b) => progress(Math.min(JRE.sizeMb, toMb(b)), total) });
  await d.fs.rm(d.paths.jreDir, { recursive: true, force: true });
  await d.fs.mkdir(d.paths.jreDir, { recursive: true });
  await d.run('tar', ['-xzf', jreFile, '-C', d.paths.jreDir, '--strip-components=1'], { onLine: d.log });
  await d.fs.rm(jreFile, { recursive: true, force: true });

  const zip = path.join(dl, 'cmdline-tools.zip');
  await d.download({ url: CMDLINE_TOOLS.url, dest: zip, checksum: CMDLINE_TOOLS.checksum, onProgress: (b) => progress(JRE.sizeMb + Math.min(CMDLINE_TOOLS.sizeMb, toMb(b)), total) });
  const unzipDir = path.join(dl, 'cmdline-tools-unzip');
  await d.fs.rm(unzipDir, { recursive: true, force: true });
  await d.extractZip(zip, unzipDir); // o zip traz uma pasta `cmdline-tools/`
  const latest = path.join(d.paths.sdkRoot, 'cmdline-tools', 'latest');
  await d.fs.rm(latest, { recursive: true, force: true });
  await d.fs.mkdir(path.dirname(latest), { recursive: true });
  await d.fs.rename(path.join(unzipDir, 'cmdline-tools'), latest);
  const bin = path.join(latest, 'bin');
  for (const f of await d.fs.readdir(bin)) await d.fs.chmod(path.join(bin, f), 0o755);
  await d.fs.rm(zip, { recursive: true, force: true });

  await d.run(sdkmanager(d), [`--sdk_root=${d.paths.sdkRoot}`, '--licenses'], { env: await sdkEnv(d), stdin: 'y\n'.repeat(30), onLine: d.log });
  progress(total, total);
}

async function installSdkPackage(pkg: string, sizeMb: number, d: RunnerDeps, progress: Progress): Promise<void> {
  await d.run(sdkmanager(d), [`--sdk_root=${d.paths.sdkRoot}`, '--install', pkg], {
    env: await sdkEnv(d), stdin: 'y\n'.repeat(5),
    onLine: (line) => { d.log(line); const pct = parseSdkPercent(line); if (pct !== null) progress((sizeMb * pct) / 100, sizeMb); },
  });
  progress(sizeMb, sizeMb);
}

async function installOllama(d: RunnerDeps, progress: Progress): Promise<void> {
  const file = path.join(d.paths.downloadsDir, 'ollama-linux-amd64.tar.zst');
  await d.download({ url: OLLAMA.url, dest: file, checksum: OLLAMA.checksum, onProgress: (b) => progress(Math.min(OLLAMA.sizeMb, toMb(b)), OLLAMA.sizeMb) });
  await d.fs.rm(d.paths.ollamaDir, { recursive: true, force: true });
  await d.fs.mkdir(d.paths.ollamaDir, { recursive: true });
  try {
    await d.run('tar', ['--zstd', '-xf', file, '-C', d.paths.ollamaDir], { onLine: d.log });
  } catch (e) {
    if (/zstd/i.test(String((e as Error).message))) throw new SetupError('process', 'o tar precisa do zstd para abrir o Ollama; rode no terminal: sudo apt install zstd', { cause: e });
    throw e;
  }
  await d.fs.rm(file, { recursive: true, force: true });
  progress(OLLAMA.sizeMb, OLLAMA.sizeMb);
}

export function createRunners(localModel: string, ollamaBin: string, d: RunnerDeps): JobRunners {
  return {
    sdk: (p) => installCmdlineTools(d, p),
    adb: (p) => installSdkPackage('platform-tools', SIZES_MB.adb, d, p),
    emu: (p) => installSdkPackage('emulator', SIZES_MB.emu, d, p),
    img: (p) => installSdkPackage(SYSTEM_IMAGE, SIZES_MB.img, d, p),
    ollama: (p) => installOllama(d, p),
    model: (p) => d.pull(localModel, ollamaBin, p),
  };
}

export function nodeRunnerDeps(paths: SetupPaths, log: (line: string) => void): RunnerDeps {
  return {
    paths,
    download: downloadResumable,
    run: (cmd, args, o) => runProcess(cmd, args, o),
    extractZip: (zip, dir) => extractZip(zip, { dir }),
    fs: { rm, mkdir, rename, chmod, readdir },
    exists: (p) => access(p).then(() => true, () => false),
    pull: (model, bin, progress) => pullModel(model, bin, nodePullDeps(log), progress),
    log,
  };
}
```

(Juntar os dois imports de `node:fs/promises` num só ao salvar; ficaram separados aqui só para leitura.)

- [ ] **Step 6: Rodar e ver passar**

Run: `npx vitest run --project electron electron/setup && npx tsc -p tsconfig.electron.json --noEmit`
Expected: PASS e sem erro de tipo. O `extract-zip` é CommonJS (`module.exports = função`); com `module: NodeNext` o `import extractZip from 'extract-zip'` recebe essa função como default, então não precisa de `esModuleInterop`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json electron/setup/ollama-pull.ts electron/setup/runners.ts electron/setup/ollama-pull.test.ts electron/setup/runners.test.ts
git commit -m "feat(onboarding): instaladores do SDK, do Ollama e do modelo, com versões fixadas"
```

---

### Task 7: Fila, papéis, teste de chave, fim do onboarding e decisão de subida

**Files:**
- Create: `electron/setup/jobs.ts`, `electron/setup/apply.ts`, `electron/setup/anthropic-key.ts`, `electron/setup/finish.ts`, `electron/setup/startup.ts`
- Test: `electron/setup/jobs.test.ts`, `electron/setup/apply.test.ts`, `electron/setup/anthropic-key.test.ts`, `electron/setup/finish.test.ts`, `electron/setup/startup.test.ts`

**Interfaces:**
- Consumes: `JobRunners` (Task 6), `JobEvent`, `JobId`, `JOB_ORDER`, `SetupMode` (Task 3), `toSetupError` (Task 3), `FinishRequest` (Task 3), `SetupFileT` (Task 3), `SetupPaths` (Task 3), `ProbeResult` (Task 4), `providerRoute` de `electron/provider-route.ts`.
- Produces: `runJobs(jobs, runners, emit, now?): Promise<void>`; `providerPatches(mode, localModel): Readonly<Record<Role, ProviderPatchBody>>`; `testAnthropicKey(key, fetch?): Promise<{ result: 'ok' | 'invalid' | 'network' }>`; `finishSetup(req, ollamaBin, deps): Promise<void>`; `decideStartup(o): Promise<{ completed: boolean; write: SetupFileT | null }>`.

- [ ] **Step 1: Escrever os testes que falham**

`electron/setup/jobs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { runJobs } from './jobs';
import type { JobRunners } from './runners';
import type { JobEvent } from './types';

const noop = async () => {};
const runners = (over: Partial<JobRunners> = {}): JobRunners => ({ sdk: noop, adb: noop, emu: noop, img: noop, ollama: noop, model: noop, ...over });

describe('runJobs', () => {
  it('põe tudo na fila, roda na ordem fixa e termina cada um em done', async () => {
    const order: string[] = [];
    const events: JobEvent[] = [];
    await runJobs(['model', 'img'], runners({
      img: async (p) => { order.push('img'); p(800, 1600); p(1600, 1600); },
      model: async (p) => { order.push('model'); p(14000, 14000); },
    }), (e) => events.push(e), () => 0);
    expect(order).toEqual(['img', 'model']);
    expect(events.slice(0, 2).map((e) => [e.id, e.state])).toEqual([['img', 'wait'], ['model', 'wait']]);
    expect(events.filter((e) => e.state === 'done').map((e) => [e.id, e.doneMb, e.totalMb])).toEqual([['img', 1600, 1600], ['model', 14000, 14000]]);
  });
  it('erro para a fila: o item vira err com o tipo, os seguintes ficam em wait', async () => {
    const events: JobEvent[] = [];
    await runJobs(['ollama', 'model'], runners({
      ollama: async (p) => { p(700, 1428); throw Object.assign(new Error('write'), { code: 'ENOSPC' }); },
      model: async () => { throw new Error('não devia rodar'); },
    }), (e) => events.push(e), () => 0);
    const last = events.at(-1)!;
    expect(last).toMatchObject({ id: 'ollama', state: 'err', doneMb: 700, totalMb: 1428, error: { kind: 'disk-full' } });
    expect(events.some((e) => e.id === 'model' && e.state === 'run')).toBe(false);
  });
  it('limita eventos de progresso a um a cada 200 ms (menos o último)', async () => {
    const events: JobEvent[] = [];
    let t = 0;
    await runJobs(['img'], runners({ img: async (p) => { for (let i = 1; i <= 100; i++) { t += 10; p(i * 16, 1600); } } }), (e) => events.push(e), () => t);
    const runs = events.filter((e) => e.state === 'run');
    expect(runs.length).toBeLessThanOrEqual(8);
    expect(events.at(-1)).toMatchObject({ state: 'done', doneMb: 1600 });
  });
});
```

`electron/setup/apply.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { providerPatches } from './apply';

const LOCAL = { mode: 'local', model: 'qwen3:14b', endpoint: 'http://127.0.0.1:11434/v1', runtime: 'ollama' };

describe('providerPatches', () => {
  it('misto: líder e escalada na nuvem, agentes locais', () => {
    expect(providerPatches('misto', 'qwen3:14b')).toEqual({
      lider: { mode: 'nuvem', model: 'claude-sonnet-5' }, worker: LOCAL, esc: { mode: 'nuvem', model: 'claude-haiku-4-5' },
    });
  });
  it('local: os três no Ollama com o modelo escolhido', () => {
    expect(providerPatches('local', 'qwen3:14b')).toEqual({ lider: LOCAL, worker: LOCAL, esc: LOCAL });
  });
  it('nuvem: os três na Anthropic', () => {
    expect(providerPatches('nuvem', 'qwen3:14b')).toEqual({
      lider: { mode: 'nuvem', model: 'claude-sonnet-5' }, worker: { mode: 'nuvem', model: 'claude-haiku-4-5' }, esc: { mode: 'nuvem', model: 'claude-haiku-4-5' },
    });
  });
});
```

`electron/setup/anthropic-key.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { testAnthropicKey } from './anthropic-key';

const KEY = 'sk-ant-' + 'x'.repeat(30);
const reply = (status: number) => (async () => new Response('{}', { status })) as unknown as typeof fetch;

describe('testAnthropicKey', () => {
  it('200 ok; 401/403 inválida; outro status ou falha de rede = network', async () => {
    expect(await testAnthropicKey(KEY, reply(200))).toEqual({ result: 'ok' });
    expect(await testAnthropicKey(KEY, reply(401))).toEqual({ result: 'invalid' });
    expect(await testAnthropicKey(KEY, reply(403))).toEqual({ result: 'invalid' });
    expect(await testAnthropicKey(KEY, reply(529))).toEqual({ result: 'network' });
    expect(await testAnthropicKey(KEY, (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch)).toEqual({ result: 'network' });
  });
  it('manda a chave no cabeçalho x-api-key para a API de modelos', async () => {
    let seen: { url: string; key: string | undefined } | null = null;
    await testAnthropicKey(KEY, (async (url: unknown, init?: { headers?: Record<string, string> }) => { seen = { url: String(url), key: init?.headers?.['x-api-key'] }; return new Response('{}'); }) as unknown as typeof fetch);
    expect(seen).toEqual({ url: 'https://api.anthropic.com/v1/models?limit=1', key: KEY });
  });
});
```

`electron/setup/finish.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { finishSetup } from './finish';
import { resolveSetupPaths } from './paths';
import type { SetupFileT } from './setup-file';

const KEY = 'sk-ant-' + 'x'.repeat(30);

function deps() {
  const log: string[] = [];
  const writes: SetupFileT[] = [];
  return {
    log, writes,
    d: {
      paths: resolveSetupPaths({}, '/home/u'),
      writeSetup: async (f: SetupFileT) => { writes.push(f); log.push(`write completed=${f.completedAt !== null}`); },
      startDaemon: async () => { log.push('start'); },
      daemon: async (method: 'PUT', p: string, body: unknown) => { log.push(`${method} ${p} ${JSON.stringify(body)}`); return null; },
      now: () => '2026-09-27T12:00:00.000Z',
    },
  };
}

describe('finishSetup', () => {
  it('grava caminhos, sobe o daemon, grava a chave, aplica os papéis e só então marca concluído', async () => {
    const { d, log, writes } = deps();
    await finishSetup({ mode: 'misto', localModel: 'gpt-oss:20b', anthropicKey: KEY }, '/opt/ollama', d);
    expect(log).toEqual([
      'write completed=false', 'start',
      `PUT /settings/anthropic-key {"key":"${KEY}"}`,
      'PUT /providers/lider {"mode":"nuvem","model":"claude-sonnet-5"}',
      'PUT /providers/worker {"mode":"local","model":"gpt-oss:20b","endpoint":"http://127.0.0.1:11434/v1","runtime":"ollama"}',
      'PUT /providers/esc {"mode":"nuvem","model":"claude-haiku-4-5"}',
      'write completed=true',
    ]);
    expect(writes[1]).toEqual({ version: 1, completedAt: '2026-09-27T12:00:00.000Z', paths: { sdkRoot: '/home/u/Android/Sdk', ollamaBin: '/opt/ollama' } });
  });
  it('sem chave não chama a rota da chave', async () => {
    const { d, log } = deps();
    await finishSetup({ mode: 'local', localModel: 'qwen3:14b', anthropicKey: null }, null, d);
    expect(log.some((l) => l.includes('anthropic-key'))).toBe(false);
  });
  it('se um papel falha, não marca concluído (a próxima abertura mostra o onboarding de novo)', async () => {
    const { d, writes } = deps();
    const failing = { ...d, daemon: async () => { throw new Error('/providers/worker → 409'); } };
    await expect(finishSetup({ mode: 'nuvem', localModel: 'gpt-oss:20b', anthropicKey: null }, null, failing)).rejects.toThrow(/409/);
    expect(writes.map((w) => w.completedAt)).toEqual([null]);
  });
});
```

`electron/setup/startup.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveSetupPaths } from './paths';
import type { ProbeResult } from './probe';
import { decideStartup } from './startup';
import type { DepStatus } from './types';

const paths = resolveSetupPaths({}, '/home/u');
const hw = { ramGiB: 64, threads: 32, cpuModel: 'x', gpu: null, diskFreeGiB: 100 };
const dep = (id: DepStatus['id'], state: DepStatus['state']): DepStatus => ({ id, state, version: null, sizeMb: null, fix: null });
const ids: DepStatus['id'][] = ['node', 'sdk', 'adb', 'emu', 'img', 'kvm', 'ollama', 'keyring'];
const probeWith = (state: (id: DepStatus['id']) => DepStatus['state']) => async (): Promise<ProbeResult> =>
  ({ report: { deps: ids.map((id) => dep(id, state(id))), hardware: hw, localModels: [] }, ollamaBin: 'ollama' });
const now = () => '2026-09-27T12:00:00.000Z';

describe('decideStartup', () => {
  it('plataforma sem suporte: segue direto, sem sondar', async () => {
    const r = await decideStartup({ supported: false, saved: null, paths, probe: async () => { throw new Error('não sonda'); }, now });
    expect(r).toEqual({ completed: true, write: null });
  });
  it('setup.json concluído: segue direto', async () => {
    const saved = { version: 1 as const, completedAt: '2026-09-01T00:00:00.000Z', paths: { sdkRoot: '/sdk', ollamaBin: null } };
    expect(await decideStartup({ supported: true, saved, paths, probe: async () => { throw new Error('não sonda'); }, now })).toEqual({ completed: true, write: null });
  });
  it('instalação existente sem setup.json e tudo ok: conclui sozinho e grava os caminhos', async () => {
    const r = await decideStartup({ supported: true, saved: null, paths, probe: probeWith(() => 'ok'), now });
    expect(r).toEqual({ completed: true, write: { version: 1, completedAt: now(), paths: { sdkRoot: paths.sdkRoot, ollamaBin: 'ollama' } } });
  });
  it('falta algo, sondagem falhou ou setup.json pela metade: mostra o onboarding', async () => {
    expect((await decideStartup({ supported: true, saved: null, paths, probe: probeWith((id) => (id === 'img' ? 'todo' : 'ok')), now })).completed).toBe(false);
    expect((await decideStartup({ supported: true, saved: null, paths, probe: async () => { throw new Error('x'); }, now })).completed).toBe(false);
    const half = { version: 1 as const, completedAt: null, paths: { sdkRoot: '/sdk', ollamaBin: null } };
    expect((await decideStartup({ supported: true, saved: half, paths, probe: probeWith((id) => (id === 'kvm' ? 'user' : 'ok')), now })).completed).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --project electron electron/setup`
Expected: FAIL nos cinco arquivos novos.

- [ ] **Step 3: Implementar**

`electron/setup/jobs.ts`:

```ts
import { toSetupError } from './errors.js';
import type { JobRunners } from './runners.js';
import { JOB_ORDER, type JobEvent, type JobId } from './types.js';

const THROTTLE_MS = 200;

/**
 * Roda os itens pedidos na ordem fixa, um por vez. Emite `wait` para todos, depois `run` (com no máximo um evento de
 * progresso a cada 200 ms, para não inundar o IPC), `done` ou `err`. Um erro para a fila; o retry manda de novo só o
 * que não terminou e os downloads continuam do `.part`.
 */
export async function runJobs(jobs: readonly JobId[], runners: JobRunners, emit: (e: JobEvent) => void, now: () => number = Date.now): Promise<void> {
  const queue = JOB_ORDER.filter((id) => jobs.includes(id));
  for (const id of queue) emit({ id, state: 'wait', doneMb: 0, totalMb: 0, error: null });
  for (const id of queue) {
    let last = { doneMb: 0, totalMb: 0 };
    let lastEmit = -Infinity;
    emit({ id, state: 'run', ...last, error: null });
    try {
      await runners[id]((doneMb, totalMb) => {
        last = { doneMb, totalMb };
        const t = now();
        if (t - lastEmit < THROTTLE_MS && doneMb < totalMb) return;
        lastEmit = t;
        emit({ id, state: 'run', doneMb, totalMb, error: null });
      });
      emit({ id, state: 'done', doneMb: last.totalMb || last.doneMb, totalMb: last.totalMb, error: null });
    } catch (e) {
      const err = toSetupError(e);
      emit({ id, state: 'err', ...last, error: { kind: err.kind, message: err.message } });
      return;
    }
  }
}
```

`electron/setup/apply.ts`:

```ts
import type { SetupMode } from './types.js';

export type Role = 'lider' | 'worker' | 'esc';
export interface ProviderPatchBody { readonly mode: 'nuvem' | 'local'; readonly model: string; readonly endpoint?: string; readonly runtime?: 'ollama' }

/** Iguais a CLOUD_MODEL e LOCAL_ENDPOINT_DEFAULT em daemon/src/provider/config.ts. */
const CLOUD: Readonly<Record<Role, string>> = { lider: 'claude-sonnet-5', worker: 'claude-haiku-4-5', esc: 'claude-haiku-4-5' };
const LOCAL_ENDPOINT = 'http://127.0.0.1:11434/v1';
const WHERE: Readonly<Record<SetupMode, Readonly<Record<Role, 'cloud' | 'local'>>>> = {
  misto: { lider: 'cloud', worker: 'local', esc: 'cloud' },
  local: { lider: 'local', worker: 'local', esc: 'local' },
  nuvem: { lider: 'cloud', worker: 'cloud', esc: 'cloud' },
};

/** Corpo do `PUT /providers/:role` de cada papel para o modo escolhido no onboarding. */
export function providerPatches(mode: SetupMode, localModel: string): Readonly<Record<Role, ProviderPatchBody>> {
  const patch = (r: Role): ProviderPatchBody => (WHERE[mode][r] === 'cloud'
    ? { mode: 'nuvem', model: CLOUD[r] }
    : { mode: 'local', model: localModel, endpoint: LOCAL_ENDPOINT, runtime: 'ollama' });
  return { lider: patch('lider'), worker: patch('worker'), esc: patch('esc') };
}
```

`electron/setup/anthropic-key.ts`:

```ts
export interface KeyTestResult { readonly result: 'ok' | 'invalid' | 'network' }

/** "Testar chave": a menor chamada autenticada da API. A chave só vai no cabeçalho, nunca em log. */
export async function testAnthropicKey(key: string, fetchFn: typeof fetch = fetch): Promise<KeyTestResult> {
  try {
    const r = await fetchFn('https://api.anthropic.com/v1/models?limit=1', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } });
    if (r.ok) return { result: 'ok' };
    return { result: r.status === 401 || r.status === 403 ? 'invalid' : 'network' };
  } catch {
    return { result: 'network' };
  }
}
```

`electron/setup/finish.ts`:

```ts
import { providerRoute } from '../provider-route.js';
import { providerPatches, type Role } from './apply.js';
import type { SetupPaths } from './paths.js';
import type { FinishRequest } from './requests.js';
import type { SetupFileT } from './setup-file.js';

export interface FinishDeps {
  readonly paths: SetupPaths;
  readonly writeSetup: (f: SetupFileT) => Promise<void>;
  /** Sobe o daemon (se ainda não subiu) e espera o gate abrir. */
  readonly startDaemon: () => Promise<void>;
  readonly daemon: (method: 'PUT', path: string, body: unknown) => Promise<unknown>;
  readonly now: () => string;
}

const ROLES: readonly Role[] = ['lider', 'worker', 'esc'];

/**
 * Fim do onboarding. Os caminhos vão para o setup.json antes de o daemon subir (ele os lê na subida); `completedAt`
 * só é gravado depois que chave e papéis foram aceitos, para uma falha no meio mostrar o onboarding de novo.
 */
export async function finishSetup(req: FinishRequest, ollamaBin: string | null, d: FinishDeps): Promise<void> {
  const paths = { sdkRoot: d.paths.sdkRoot, ollamaBin };
  await d.writeSetup({ version: 1, completedAt: null, paths });
  await d.startDaemon();
  if (req.anthropicKey) await d.daemon('PUT', '/settings/anthropic-key', { key: req.anthropicKey });
  const patches = providerPatches(req.mode, req.localModel);
  for (const role of ROLES) await d.daemon('PUT', providerRoute(role, 'put'), patches[role]);
  await d.writeSetup({ version: 1, completedAt: d.now(), paths });
}
```

`electron/setup/startup.ts`:

```ts
import type { SetupPaths } from './paths.js';
import type { ProbeResult } from './probe.js';
import type { SetupFileT } from './setup-file.js';

/**
 * Onboarding aparece só em Linux x86_64 sem setup.json concluído. Quem já usava o Enxame antes dele existir (tudo
 * `ok`) não vê nada: gravamos o setup.json concluído com os caminhos achados e o app sobe como antes.
 */
export async function decideStartup(o: {
  readonly supported: boolean; readonly saved: SetupFileT | null; readonly paths: SetupPaths;
  readonly probe: () => Promise<ProbeResult>; readonly now: () => string;
}): Promise<{ completed: boolean; write: SetupFileT | null }> {
  if (!o.supported || o.saved?.completedAt) return { completed: true, write: null };
  const r = await o.probe().catch(() => null);
  if (!r || r.report.deps.some((d) => d.state !== 'ok')) return { completed: false, write: null };
  return { completed: true, write: { version: 1, completedAt: o.now(), paths: { sdkRoot: o.paths.sdkRoot, ollamaBin: r.ollamaBin } } };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run --project electron electron/setup`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/setup/jobs.ts electron/setup/apply.ts electron/setup/anthropic-key.ts electron/setup/finish.ts electron/setup/startup.ts electron/setup/*.test.ts
git commit -m "feat(onboarding): fila de instalação, papéis por modo, teste de chave e fim do onboarding"
```

---

### Task 8: Canais IPC, subida do daemon condicionada e preload

**Files:**
- Create: `electron/setup/ipc.ts`
- Test: `electron/setup/ipc.test.ts`
- Modify: `electron/main.ts`, `electron/preload.cts`, `electron/daemon-bridge.ts`

**Interfaces:**
- Consumes: tudo das Tasks 3–7.
- Produces: canais `enxame:setup:status` → `{ completed, supported }`, `enxame:setup:check` → `SetupReport`, `enxame:setup:install` (`InstallRequest`) → `void` (eventos em `enxame:setup:job` com `JobEvent` e `enxame:setup:log` com `string`), `enxame:setup:testKey` (`string`) → `{ result }`, `enxame:setup:finish` (`FinishRequest`) → `void`. No preload: `window.enxame.setup = { status, check, install, onJob, onLog, testKey, finish }` (a Task 10 tipa isso no renderer).

- [ ] **Step 1: Escrever o teste que falha**

`electron/setup/ipc.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { registerSetupIpc, type SetupIpcDeps } from './ipc';
import { resolveSetupPaths } from './paths';
import type { JobRunners } from './runners';

const KEY = 'sk-ant-' + 'x'.repeat(30);
const report = { deps: [], hardware: { ramGiB: 1, threads: 1, cpuModel: 'x', gpu: null, diskFreeGiB: 1 }, localModels: [] };

function mk(over: Partial<SetupIpcDeps> = {}) {
  const handlers = new Map<string, (...a: unknown[]) => unknown>();
  const sent: [string, unknown][] = [];
  const finished: [unknown, string | null][] = [];
  const noop = async () => {};
  const runners: JobRunners = { sdk: noop, adb: noop, emu: noop, img: noop, ollama: noop, model: async (p) => p(5, 10) };
  const deps: SetupIpcDeps = {
    handle: (ch, fn) => handlers.set(ch, fn),
    send: (ch, d) => sent.push([ch, d]),
    paths: resolveSetupPaths({}, '/home/u'),
    status: async () => ({ completed: false, supported: true }),
    probe: async () => ({ report, ollamaBin: 'ollama' }),
    runners: () => runners,
    testKey: async () => ({ result: 'ok' }),
    finish: async (req, bin) => { finished.push([req, bin]); },
    ...over,
  };
  registerSetupIpc(deps);
  const call = (ch: string, ...args: unknown[]) => handlers.get(ch)!({}, ...args);
  return { call, sent, finished };
}

describe('registerSetupIpc', () => {
  it('check devolve só o relatório; finish recebe o ollamaBin achado na verificação', async () => {
    const { call, finished } = mk();
    expect(await call('enxame:setup:check')).toEqual(report);
    await call('enxame:setup:finish', { mode: 'misto', localModel: 'gpt-oss:20b', anthropicKey: KEY });
    expect(finished).toEqual([[{ mode: 'misto', localModel: 'gpt-oss:20b', anthropicKey: KEY }, 'ollama']]);
  });
  it('install valida o pedido, manda eventos e, com o Ollama instalado pelo Enxame, finish usa o binário dele', async () => {
    const { call, sent, finished } = mk();
    await call('enxame:setup:install', { jobs: ['ollama', 'model'], localModel: 'gpt-oss:20b' });
    expect(sent.filter(([ch]) => ch === 'enxame:setup:job').map(([, e]) => (e as { id: string; state: string }).state)).toContain('done');
    await call('enxame:setup:finish', { mode: 'local', localModel: 'gpt-oss:20b', anthropicKey: null });
    expect(finished[0][1]).toBe('/home/u/.local/share/enxame/tools/ollama/bin/ollama');
  });
  it('recusa pedido inválido e instalação em dobro', async () => {
    let release: () => void = () => {};
    const slow: JobRunners = { sdk: async () => {}, adb: async () => {}, emu: async () => {}, img: () => new Promise<void>((r) => { release = r; }), ollama: async () => {}, model: async () => {} };
    const { call } = mk({ runners: () => slow });
    await expect(call('enxame:setup:install', { jobs: ['rm'], localModel: 'x' })).rejects.toThrow();
    const first = call('enxame:setup:install', { jobs: ['img'], localModel: 'gpt-oss:20b' }) as Promise<void>;
    await expect(call('enxame:setup:install', { jobs: ['img'], localModel: 'gpt-oss:20b' })).rejects.toThrow(/em andamento/);
    release();
    await first;
  });
  it('testKey valida a chave antes de sair para a rede', async () => {
    const { call } = mk();
    await expect(call('enxame:setup:testKey', 'abc')).rejects.toThrow();
    expect(await call('enxame:setup:testKey', KEY)).toEqual({ result: 'ok' });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --project electron electron/setup/ipc.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `electron/setup/ipc.ts`**

```ts
import type { KeyTestResult } from './anthropic-key.js';
import { runJobs } from './jobs.js';
import type { SetupPaths } from './paths.js';
import type { ProbeResult } from './probe.js';
import { AnthropicKeySchema, FinishRequestSchema, InstallRequestSchema, type FinishRequest } from './requests.js';
import type { JobRunners } from './runners.js';

export interface SetupIpcDeps {
  readonly handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => void;
  readonly send: (channel: string, data: unknown) => void;
  readonly paths: SetupPaths;
  readonly status: () => Promise<{ completed: boolean; supported: boolean }>;
  readonly probe: () => Promise<ProbeResult>;
  readonly runners: (localModel: string, ollamaBin: string, log: (line: string) => void) => JobRunners;
  readonly testKey: (key: string) => Promise<KeyTestResult>;
  readonly finish: (req: FinishRequest, ollamaBin: string | null) => Promise<void>;
}

/** Canais do onboarding. Tudo que vem do renderer passa por zod antes de virar comando, caminho ou chamada de rede. */
export function registerSetupIpc(d: SetupIpcDeps): void {
  // O binário que o `finish` grava no setup.json: o achado na verificação, ou o nosso depois de instalar.
  let ollamaBin: string | null = null;
  let running: Promise<void> | null = null;

  d.handle('enxame:setup:status', () => d.status());
  d.handle('enxame:setup:check', async () => {
    const r = await d.probe();
    ollamaBin = r.ollamaBin;
    return r.report;
  });
  d.handle('enxame:setup:install', async (_e, raw) => {
    const req = InstallRequestSchema.parse(raw);
    if (running) throw new Error('instalação já em andamento');
    const log = (line: string) => d.send('enxame:setup:log', line);
    const bin = req.jobs.includes('ollama') ? d.paths.ollamaBin : (ollamaBin ?? d.paths.ollamaBin);
    running = runJobs(req.jobs, d.runners(req.localModel, bin, log), (ev) => {
      if (ev.id === 'ollama' && ev.state === 'done') ollamaBin = d.paths.ollamaBin;
      d.send('enxame:setup:job', ev);
    });
    try { await running; } finally { running = null; }
  });
  d.handle('enxame:setup:testKey', (_e, raw) => d.testKey(AnthropicKeySchema.parse(raw)));
  d.handle('enxame:setup:finish', (_e, raw) => d.finish(FinishRequestSchema.parse(raw), ollamaBin));
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run --project electron electron/setup/ipc.test.ts`
Expected: PASS.

- [ ] **Step 5: `electron/daemon-bridge.ts` não derruba o main sem Node**

Em `ensureDaemon`, trocar as duas últimas linhas por:

```ts
  const child = spawn('node', ['--env-file-if-exists=.env', 'dist-daemon/index.js'], { cwd: projectRoot, stdio: 'inherit', env: process.env });
  // Sem `node` no PATH o spawn emite 'error'; sem este ouvinte o main cairia. O waitForInfo expira e a tela mostra o erro.
  child.on('error', (e) => console.error('[enxame] não deu para subir o daemon:', e.message));
  return child;
```

- [ ] **Step 6: Ligar em `electron/main.ts`**

1. Imports novos:

```ts
import os from 'node:os';
import { testAnthropicKey } from './setup/anthropic-key.js';
import { finishSetup } from './setup/finish.js';
import { nodeHardwareDeps } from './setup/hardware.js';
import { registerSetupIpc } from './setup/ipc.js';
import { resolveSetupPaths } from './setup/paths.js';
import { nodeProbeDeps, probeSetup } from './setup/probe.js';
import { createRunners, nodeRunnerDeps } from './setup/runners.js';
import { readSetupFileSync, writeSetupFile } from './setup/setup-file.js';
import { decideStartup } from './setup/startup.js';
```

2. Dentro de `app.whenReady().then(() => { … })`, trocar o bloco final (de `const projectRoot = …` até o `.catch(...)` do `waitForInfo`) por:

```ts
  const projectRoot = path.join(here, '..');
  const broadcast = (ch: string, d: unknown) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send(ch, d); };

  // Sobe o daemon uma vez (idempotente); falhou, a próxima chamada tenta de novo.
  let daemonStart: Promise<void> | null = null;
  const startDaemon = (): Promise<void> => {
    daemonStart ??= (async () => {
      ensureDaemon(projectRoot);
      const info = await waitForInfo();
      gate.set(info);
      void migrateCredentials();
      connectSnapshots(info, {
        onSnapshot: (data) => { lastSnapshot = data; broadcast('enxame:snapshot', data); },
        onFrame: (f) => { const id = (f as { id?: unknown })?.id; if (typeof id === 'string') lastFrames.set(id, f); broadcast('enxame:frame', f); },
        onVideo: (p) => { gop.push(p as never); broadcast('enxame:video', p); },
      });
    })().catch((e: Error) => { gate.fail(e.message); console.error('[enxame] sem daemon:', e.message); daemonStart = null; throw e; });
    return daemonStart;
  };

  // Onboarding (spec onboarding): leitura síncrona do setup.json para os canais existirem antes de a janela pedir.
  const supported = process.platform === 'linux' && os.arch() === 'x64';
  const saved = readSetupFileSync(resolveSetupPaths().setupFile);
  const paths = resolveSetupPaths(process.env, os.homedir(), saved?.paths.sdkRoot ?? null);
  const probe = () => probeSetup(paths, nodeProbeDeps(), nodeHardwareDeps());
  const startupP = decideStartup({ supported, saved, paths, probe, now: () => new Date().toISOString() }).then(async (s) => {
    if (s.write) await writeSetupFile(paths.setupFile, s.write).catch((e: Error) => console.error('[enxame] setup.json:', e.message));
    return s;
  });
  void startupP.then((s) => { if (s.completed) void startDaemon().catch(() => undefined); });

  registerSetupIpc({
    handle: (ch, fn) => ipcMain.handle(ch, fn),
    send: broadcast,
    paths,
    status: async () => ({ completed: (await startupP).completed, supported }),
    probe,
    runners: (localModel, bin, log) => createRunners(localModel, bin, nodeRunnerDeps(paths, log)),
    testKey: (key) => testAnthropicKey(key),
    finish: (req, bin) => finishSetup(req, bin, {
      paths, writeSetup: (f) => writeSetupFile(paths.setupFile, f), startDaemon,
      daemon: (method, p, body) => daemon(method, p, body), now: () => new Date().toISOString(),
    }),
  });
```

Nota: tudo acima roda de forma síncrona dentro do `whenReady`, então os canais `enxame:setup:*` existem antes de a página terminar de carregar. `createWindow()` continua onde está (a janela só chama `setup.status()` depois de montar o React).

- [ ] **Step 7: Expor no preload**

Em `electron/preload.cts`, dentro do objeto de `exposeInMainWorld`, depois de `login: …`, acrescentar:

```ts
  // Onboarding (spec onboarding): verificação, instalação com eventos e fim; nada aqui recebe senha além da chave, que vai direto ao main.
  setup: {
    status: () => ipcRenderer.invoke('enxame:setup:status'),
    check: () => ipcRenderer.invoke('enxame:setup:check'),
    install: (req: unknown) => ipcRenderer.invoke('enxame:setup:install', req),
    onJob: (cb: (e: unknown) => void) => {
      const listener = (_e: unknown, data: unknown) => cb(data);
      ipcRenderer.on('enxame:setup:job', listener);
      return () => ipcRenderer.removeListener('enxame:setup:job', listener);
    },
    onLog: (cb: (line: string) => void) => {
      const listener = (_e: unknown, line: unknown) => cb(String(line));
      ipcRenderer.on('enxame:setup:log', listener);
      return () => ipcRenderer.removeListener('enxame:setup:log', listener);
    },
    testKey: (key: string) => ipcRenderer.invoke('enxame:setup:testKey', key),
    finish: (req: unknown) => ipcRenderer.invoke('enxame:setup:finish', req),
  },
```

- [ ] **Step 8: Verificar**

Run: `npx vitest run --project electron && npx tsc -p tsconfig.electron.json --noEmit`
Expected: PASS e sem erro de tipo.

- [ ] **Step 9: Commit**

```bash
git add electron/setup/ipc.ts electron/setup/ipc.test.ts electron/main.ts electron/preload.cts electron/daemon-bridge.ts
git commit -m "feat(onboarding): canais de setup no main e daemon só sobe com a máquina pronta"
```

---

### Task 9: Textos do onboarding nos seis idiomas

**Files:**
- Create: `src/i18n/messages/onboarding.ts`
- Modify: `src/i18n/messages/index.ts`, `src/i18n/messages/providers.ts`
- Test: `src/i18n/i18n.test.ts` (já cobre; só rodar)

**Interfaces:**
- Produces: chaves `onboarding.*` listadas abaixo e `providers.setup`. As Tasks 10–12 usam exatamente estes nomes.

- [ ] **Step 1: Criar `src/i18n/messages/onboarding.ts`**

O português abaixo é a fonte. O inglês está completo. Para `es`, `fr`, `de` e `zh`, traduzir cada chave do português com o mesmo tom (frases curtas, voz ativa, sem jargão), mantendo **exatamente** os mesmos `{placeholders}`; nomes próprios e comandos (`Node.js`, `/dev/kvm`, `sudo usermod -aG kvm $USER`, `console.anthropic.com`, `~/.local`, `Ollama`, `Claude`) não se traduzem. O `defineMessages` falha na compilação se faltar ou sobrar chave.

```ts
import { defineMessages } from '../define';

/** Onboarding de primeira execução (spec onboarding). */
export const onboarding = defineMessages({
  'rail.firstRun': 'Primeira execução',
  'rail.redo': 'Dá para refazer esta verificação depois em Provedores → Verificar dependências.',
  'step.check': 'Verificar', 'step.check.sub': 'O que já está na máquina',
  'step.models': 'Modelos', 'step.models.sub': 'Quem pensa pelos agentes',
  'step.install': 'Instalar', 'step.install.sub': 'Baixar o que falta',
  'step.ready': 'Pronto', 'step.ready.sub': 'Primeira identidade',
  'check.title': 'Vamos deixar sua máquina pronta',
  'check.lede': 'O Enxame precisa do Android e de um modelo de IA para funcionar. Verificamos o que já está instalado. O que faltar, a gente baixa e configura para você.',
  'check.loading': 'Verificando a máquina…',
  'check.failed': 'Não deu para verificar a máquina: {error}',
  'check.retry': 'Verificar de novo',
  'summary.ok': 'Prontos', 'summary.okOf': 'de {total} itens',
  'summary.todo': 'Para instalar', 'summary.download': '{size} de download',
  'summary.user': 'Precisam de você', 'summary.userSome': 'resolva e verifique de novo', 'summary.userNone': 'nada a fazer',
  'state.ok': 'Instalado', 'state.todo': 'Vamos instalar', 'state.user': 'Precisa de você',
  'dep.node': 'Node.js 24 ou mais novo', 'dep.node.role': 'Roda o motor do Enxame',
  'dep.sdk': 'Android SDK', 'dep.sdk.role': 'Base para criar e rodar os emuladores',
  'dep.adb': 'platform-tools (adb)', 'dep.adb.role': 'Canal entre o Enxame e os emuladores',
  'dep.emu': 'Android Emulator', 'dep.emu.role': 'Roda cada identidade como um celular',
  'dep.img': 'Android 14 · Google Play · x86_64', 'dep.img.role': 'Sistema que cada identidade usa (API 34)',
  'dep.kvm': 'Aceleração de hardware (KVM)', 'dep.kvm.role': 'Sem ela o emulador fica lento demais para os agentes',
  'dep.ollama': 'Ollama', 'dep.ollama.role': 'Roda modelos de IA no seu computador',
  'dep.model': 'Modelo local {model}', 'dep.model.role': 'Pensa pelos agentes sem custo por uso',
  'dep.keyring': 'Chaveiro do sistema', 'dep.keyring.role': 'Guarda as senhas das contas com segurança',
  'fix.node-missing': 'Instale o Node.js 24 ou mais novo pelo site nodejs.org e abra o Enxame de novo.',
  'fix.kvm-group': 'O emulador existe, mas seu usuário não pode usar /dev/kvm. Rode no terminal, saia da sessão e entre de novo:',
  'fix.kvm-bios': 'Este computador não mostra /dev/kvm. Ative a virtualização (Intel VT-x ou AMD-V) na BIOS e reinicie.',
  'fix.keyring-locked': 'O chaveiro do sistema está trancado ou não existe. Abra o app Senhas e Chaves, desbloqueie o chaveiro "Login" e verifique de novo.',
  'fix.copy': 'Copiar', 'fix.copied': 'Copiado',
  'hw.title': 'Seu computador', 'hw.ram': 'Memória', 'hw.cpu': 'Processador', 'hw.gpu': 'Placa de vídeo', 'hw.disk': 'Disco livre',
  'hw.cpuValue': '{threads} threads · {model}', 'hw.gpuNone': 'Nenhuma placa NVIDIA',
  'hw.capacity': 'Emuladores ao mesmo tempo',
  'hw.capacityNote': 'Cada um usa cerca de {ram} de memória e 4 threads.',
  'hw.limit.cpu': 'O limite vem do processador.', 'hw.limit.ram': 'O limite vem da memória.',
  'models.title': 'Quem vai pensar pelos agentes?',
  'models.lede': 'Cada papel usa um modelo. Escolha um ponto de partida. Você pode trocar o modelo de cada papel depois, em Provedores.',
  'mode.recommended': 'Recomendado',
  'mode.misto': 'Misto', 'mode.misto.text': 'O líder usa a nuvem para planejar bem. Os agentes rodam no seu computador.',
  'mode.local': 'Só local', 'mode.local.text': 'Tudo no seu computador. Funciona sem internet e não tem custo por uso.',
  'mode.nuvem': 'Só nuvem', 'mode.nuvem.text': 'Tudo na Anthropic. Não precisa de Ollama nem de placa de vídeo.',
  'role.lider': 'Líder', 'role.worker': 'Agentes', 'role.esc': 'Escalada', 'role.cloud': 'Claude', 'role.local': 'local',
  'models.localTitle': 'Modelo local · roda no Ollama',
  'model.recommended': 'Recomendado', 'model.installed': 'Já baixado', 'model.tooBig': 'Não cabe', 'model.tight': 'Ocupa quase toda a placa',
  'model.cpu': 'Sem placa NVIDIA: roda no processador, bem mais devagar',
  'model.vram': '{size} de vídeo',
  'model.note.gptoss20': 'Padrão do Enxame. Bom em chamar ferramentas.',
  'model.note.qwen14': 'Mais leve. Sobra espaço para outro modelo.',
  'model.note.qwen32': 'Mais capaz, ocupa quase toda a placa.',
  'model.note.gptoss120': 'Precisa de uma placa com mais de 64 GB.',
  'vram.title': 'Memória da placa de vídeo', 'vram.system': 'Sistema {size}', 'vram.model': '{model} {size}', 'vram.free': 'Livre {free} de {total}',
  'key.label': 'Chave da API da Anthropic',
  'key.help': 'Fica guardada no chaveiro do sistema, nunca em arquivo. Você cria a chave em console.anthropic.com.',
  'key.test': 'Testar chave', 'key.testing': 'Testando…', 'key.ok': 'Chave válida',
  'key.invalid': 'A Anthropic recusou esta chave. Confira se copiou a chave inteira.',
  'key.network': 'Não deu para falar com a Anthropic. Confira a internet e teste de novo.',
  'key.empty': 'Sem chave, o líder divide o objetivo com uma regra simples e não há escalada para a nuvem.',
  'key.localOnly': 'Sem chave e sem internet depois da instalação. Missões longas podem errar mais sem a escalada para a nuvem.',
  'install.title': 'Instalando o que falta',
  'install.lede': 'Pode deixar esta janela aberta e fazer outra coisa. Se fechar o app, o download continua de onde parou na próxima vez.',
  'install.of': 'de {total} · {done} de {count} itens prontos',
  'install.nothing': 'Nada para instalar. Tudo já estava pronto.',
  'install.details': 'Ver detalhes técnicos',
  'install.ollamaNote': 'Instala em ~/.local, sem pedir senha de administrador',
  'job.wait': 'Na fila', 'job.run': 'Baixando', 'job.done': 'Concluído', 'job.err': 'Falhou',
  'job.progress': '{done} de {total}',
  'err.disk-full.title': 'Disco cheio', 'err.disk-full': 'Faltou espaço em disco. Libere espaço e continue de onde parou, ou escolha um modelo menor.',
  'err.network.title': 'Sem conexão', 'err.network': 'O download parou por falta de conexão. Confira a internet e continue de onde parou.',
  'err.checksum.title': 'Arquivo corrompido', 'err.checksum': 'O arquivo baixado não bate com o original. Tente de novo: o download recomeça do zero.',
  'err.process.title': 'A instalação falhou', 'err.process': '{message}',
  'err.retry': 'Continuar download', 'err.otherModel': 'Escolher outro modelo',
  'ready.title': 'Tudo pronto',
  'ready.lede': 'A máquina tem tudo que o Enxame precisa. Falta criar a primeira identidade: um emulador ligado a uma conta sua.',
  'ready.done': 'Instalado e testado',
  'ready.android': 'Android 14 com Google Play, pronto para criar emuladores',
  'ready.kvm': 'Aceleração de hardware ativa',
  'ready.local': 'Ollama com {model} no disco', 'ready.cloud': 'Modelos na nuvem pela Anthropic',
  'ready.mode': 'Papéis configurados no modo {mode}',
  'ready.keyring': 'Senhas guardadas no chaveiro do sistema',
  'ready.next': 'Próximo passo', 'ready.nextTitle': 'Criar a primeira identidade',
  'ready.nextText': 'Na tela Identidades você cria o emulador e entra na conta uma única vez.',
  'ready.create': 'Criar identidade',
  'nav.back': 'Voltar', 'nav.continue': 'Continuar', 'nav.install': 'Instalar', 'nav.finish': 'Abrir o Cockpit', 'nav.finishing': 'Configurando…',
  'hint.needsYou': 'Resolva o item marcado para continuar',
  'hint.willInstall': 'Itens para instalar no próximo passo: {count}',
  'hint.nothing': 'Nada para instalar',
  'hint.download': '{size} de download',
  'hint.diskLow': '{size} de download, mas só {free} livres em disco',
  'hint.installing': 'Instalando…', 'hint.error': 'A instalação parou. Veja o aviso acima.', 'hint.done': 'Instalação concluída',
  'hint.finishFailed': 'Não deu para configurar os papéis: {error}',
  'hint.ready': 'Você pode criar a identidade depois, em Identidades.',
}, {
  en: {
    'rail.firstRun': 'First run',
    'rail.redo': 'You can run this check again later in Providers → Check dependencies.',
    'step.check': 'Check', 'step.check.sub': 'What this machine already has',
    'step.models': 'Models', 'step.models.sub': 'Who thinks for the agents',
    'step.install': 'Install', 'step.install.sub': 'Download what is missing',
    'step.ready': 'Ready', 'step.ready.sub': 'First identity',
    'check.title': "Let's get your machine ready",
    'check.lede': 'Enxame needs Android and an AI model to work. We checked what is already installed. Whatever is missing, we download and set up for you.',
    'check.loading': 'Checking this machine…',
    'check.failed': 'Could not check this machine: {error}',
    'check.retry': 'Check again',
    'summary.ok': 'Ready', 'summary.okOf': 'of {total} items',
    'summary.todo': 'To install', 'summary.download': '{size} to download',
    'summary.user': 'Need you', 'summary.userSome': 'fix it and check again', 'summary.userNone': 'nothing to do',
    'state.ok': 'Installed', 'state.todo': 'Will install', 'state.user': 'Needs you',
    'dep.node': 'Node.js 24 or newer', 'dep.node.role': 'Runs the Enxame engine',
    'dep.sdk': 'Android SDK', 'dep.sdk.role': 'Creates and runs the emulators',
    'dep.adb': 'platform-tools (adb)', 'dep.adb.role': 'Connects Enxame to the emulators',
    'dep.emu': 'Android Emulator', 'dep.emu.role': 'Runs each identity as a phone',
    'dep.img': 'Android 14 · Google Play · x86_64', 'dep.img.role': 'The system every identity runs (API 34)',
    'dep.kvm': 'Hardware acceleration (KVM)', 'dep.kvm.role': 'Without it the emulator is too slow for the agents',
    'dep.ollama': 'Ollama', 'dep.ollama.role': 'Runs AI models on your computer',
    'dep.model': 'Local model {model}', 'dep.model.role': 'Thinks for the agents with no per-use cost',
    'dep.keyring': 'System keyring', 'dep.keyring.role': 'Keeps account passwords safe',
    'fix.node-missing': 'Install Node.js 24 or newer from nodejs.org and open Enxame again.',
    'fix.kvm-group': 'The emulator is there, but your user cannot use /dev/kvm. Run this in a terminal, then log out and back in:',
    'fix.kvm-bios': 'This computer does not expose /dev/kvm. Turn on virtualization (Intel VT-x or AMD-V) in the BIOS and restart.',
    'fix.keyring-locked': 'The system keyring is locked or missing. Open Passwords and Keys, unlock the "Login" keyring and check again.',
    'fix.copy': 'Copy', 'fix.copied': 'Copied',
    'hw.title': 'Your computer', 'hw.ram': 'Memory', 'hw.cpu': 'Processor', 'hw.gpu': 'Graphics card', 'hw.disk': 'Free disk',
    'hw.cpuValue': '{threads} threads · {model}', 'hw.gpuNone': 'No NVIDIA card',
    'hw.capacity': 'Emulators at the same time',
    'hw.capacityNote': 'Each one uses about {ram} of memory and 4 threads.',
    'hw.limit.cpu': 'The processor sets the limit.', 'hw.limit.ram': 'Memory sets the limit.',
    'models.title': 'Who will think for the agents?',
    'models.lede': 'Each role uses a model. Pick a starting point. You can change the model of each role later in Providers.',
    'mode.recommended': 'Recommended',
    'mode.misto': 'Mixed', 'mode.misto.text': 'The leader plans in the cloud. The agents run on your computer.',
    'mode.local': 'Local only', 'mode.local.text': 'Everything on your computer. Works offline with no per-use cost.',
    'mode.nuvem': 'Cloud only', 'mode.nuvem.text': 'Everything at Anthropic. No Ollama or graphics card needed.',
    'role.lider': 'Leader', 'role.worker': 'Agents', 'role.esc': 'Escalation', 'role.cloud': 'Claude', 'role.local': 'local',
    'models.localTitle': 'Local model · runs on Ollama',
    'model.recommended': 'Recommended', 'model.installed': 'Already downloaded', 'model.tooBig': 'Does not fit', 'model.tight': 'Uses almost the whole card',
    'model.cpu': 'No NVIDIA card: runs on the processor, much slower',
    'model.vram': '{size} of video memory',
    'model.note.gptoss20': 'Enxame default. Good at calling tools.',
    'model.note.qwen14': 'Lighter. Leaves room for another model.',
    'model.note.qwen32': 'More capable, uses almost the whole card.',
    'model.note.gptoss120': 'Needs a card with more than 64 GB.',
    'vram.title': 'Graphics card memory', 'vram.system': 'System {size}', 'vram.model': '{model} {size}', 'vram.free': 'Free {free} of {total}',
    'key.label': 'Anthropic API key',
    'key.help': 'Stored in the system keyring, never in a file. Create a key at console.anthropic.com.',
    'key.test': 'Test key', 'key.testing': 'Testing…', 'key.ok': 'Key works',
    'key.invalid': 'Anthropic rejected this key. Check that you copied the whole key.',
    'key.network': 'Could not reach Anthropic. Check your internet and test again.',
    'key.empty': 'Without a key, the leader splits goals with a simple rule and there is no escalation to the cloud.',
    'key.localOnly': 'No key and no internet after setup. Long missions may fail more often without cloud escalation.',
    'install.title': 'Installing what is missing',
    'install.lede': 'You can leave this window open and do something else. If you close the app, the download resumes next time.',
    'install.of': 'of {total} · {done} of {count} items ready',
    'install.nothing': 'Nothing to install. Everything was already there.',
    'install.details': 'Show technical details',
    'install.ollamaNote': 'Installs in ~/.local, no administrator password',
    'job.wait': 'Queued', 'job.run': 'Downloading', 'job.done': 'Done', 'job.err': 'Failed',
    'job.progress': '{done} of {total}',
    'err.disk-full.title': 'Disk full', 'err.disk-full': 'The disk ran out of space. Free some space and resume, or pick a smaller model.',
    'err.network.title': 'No connection', 'err.network': 'The download stopped because the connection dropped. Check your internet and resume.',
    'err.checksum.title': 'Corrupted file', 'err.checksum': 'The downloaded file does not match the original. Try again: the download starts over.',
    'err.process.title': 'Installation failed', 'err.process': '{message}',
    'err.retry': 'Resume download', 'err.otherModel': 'Pick another model',
    'ready.title': 'All set',
    'ready.lede': 'This machine has everything Enxame needs. Next, create the first identity: an emulator tied to one of your accounts.',
    'ready.done': 'Installed and tested',
    'ready.android': 'Android 14 with Google Play, ready to create emulators',
    'ready.kvm': 'Hardware acceleration on',
    'ready.local': 'Ollama with {model} on disk', 'ready.cloud': 'Cloud models through Anthropic',
    'ready.mode': 'Roles set to {mode} mode',
    'ready.keyring': 'Passwords kept in the system keyring',
    'ready.next': 'Next step', 'ready.nextTitle': 'Create the first identity',
    'ready.nextText': 'In Identities you create the emulator and sign in to the account once.',
    'ready.create': 'Create identity',
    'nav.back': 'Back', 'nav.continue': 'Continue', 'nav.install': 'Install', 'nav.finish': 'Open the Cockpit', 'nav.finishing': 'Setting up…',
    'hint.needsYou': 'Fix the marked item to continue',
    'hint.willInstall': 'Items to install in the next step: {count}',
    'hint.nothing': 'Nothing to install',
    'hint.download': '{size} to download',
    'hint.diskLow': '{size} to download, but only {free} free on disk',
    'hint.installing': 'Installing…', 'hint.error': 'Installation stopped. See the notice above.', 'hint.done': 'Installation complete',
    'hint.finishFailed': 'Could not set up the roles: {error}',
    'hint.ready': 'You can create the identity later in Identities.',
  },
  es: { /* traduzir cada chave do português (ver instrução acima) */ },
  fr: { /* idem */ },
  de: { /* idem */ },
  zh: { /* idem */ },
});
```

Os quatro objetos `es`, `fr`, `de`, `zh` precisam sair deste passo **preenchidos** com todas as chaves; o comentário acima só marca onde entram.

- [ ] **Step 2: Registrar o namespace e a chave de Provedores**

Em `src/i18n/messages/index.ts`: `import { onboarding } from './onboarding';` e acrescentar `onboarding` ao objeto `NAMESPACES`.

Em `src/i18n/messages/providers.ts`, acrescentar a chave `'setup'` em todos os idiomas: pt `'Verificar dependências'`, en `'Check dependencies'`, es `'Verificar dependencias'`, fr `'Vérifier les dépendances'`, de `'Abhängigkeiten prüfen'`, zh `'检查依赖项'`.

- [ ] **Step 3: Rodar**

Run: `npx vitest run --project renderer src/i18n && npx tsc -b --noEmit`
Expected: PASS; `todos os idiomas têm todas as chaves` e `placeholders iguais` verdes.

- [ ] **Step 4: Commit**

```bash
git add src/i18n/messages/onboarding.ts src/i18n/messages/index.ts src/i18n/messages/providers.ts
git commit -m "feat(onboarding): textos do onboarding nos seis idiomas"
```

---

### Task 10: Estado e seletores do onboarding no renderer

**Files:**
- Create: `src/onboarding/schema.ts`, `src/onboarding/catalog.ts`, `src/onboarding/reducer.ts`, `src/onboarding/view.ts`
- Modify: `src/live/types.ts` (tipo `SetupBridge` e campo `setup?` em `EnxameBridge`)
- Test: `src/onboarding/reducer.test.ts`, `src/onboarding/view.test.ts`

**Interfaces:**
- Consumes: formato dos DTOs da Task 3 (espelhado em zod), chaves `onboarding.*` da Task 9, `I18n` de `src/i18n/translate.ts`.
- Produces:
  - `schema.ts`: `SetupReportSchema`, `JobEventSchema`, `SetupStatusSchema`, `KeyTestSchema`, tipos `SetupReport`, `Hardware`, `DepStatus`, `DepId`, `JobId`, `JobEvent`, `UserFix`, `JOB_IDS`.
  - `catalog.ts`: `SetupMode`, `MODES`, `ModelEntry`, `LOCAL_MODELS`, `VRAM_SYSTEM_GIB`, `MODE_ROLES`, `RAM_PER_EMULATOR_GIB`, `THREADS_PER_EMULATOR`.
  - `reducer.ts`: `Step`, `OnboardingState`, `OnboardingAction`, `INITIAL_STATE`, `onboardingReducer`.
  - `view.ts`: `RowId`, `DepRow`, `depRows`, `summarize`, `jobsToInstall`, `emulatorCapacity`, `ModelFit`, `modelFit`, `defaultModel`, `defaultMode`, `vramBar`, `installTotals`, `formatMb`, `ipcErrorText`, `footerView`, `FooterView`.
  - `src/live/types.ts`: `SetupBridge`.

- [ ] **Step 1: Escrever os testes que falham**

`src/onboarding/view.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PT, createI18n } from '../i18n/translate';
import { LOCAL_MODELS } from './catalog';
import { INITIAL_STATE, type OnboardingState } from './reducer';
import type { DepStatus, SetupReport } from './schema';
import {
  defaultMode, defaultModel, depRows, emulatorCapacity, footerView, formatMb, installTotals, ipcErrorText, jobsToInstall, modelFit, summarize, vramBar,
} from './view';

const dep = (id: DepStatus['id'], state: DepStatus['state'], over: Partial<DepStatus> = {}): DepStatus => ({ id, state, version: null, sizeMb: null, fix: null, ...over });
const rtx = { name: 'RTX 4090', totalGiB: 24 };
const hw = { ramGiB: 64, threads: 32, cpuModel: 'Ryzen', gpu: rtx, diskFreeGiB: 412 };
const partial: SetupReport = {
  deps: [dep('node', 'ok'), dep('sdk', 'ok'), dep('adb', 'ok'), dep('emu', 'ok'), dep('img', 'todo', { sizeMb: 1600 }), dep('kvm', 'ok'), dep('ollama', 'ok'), dep('keyring', 'ok')],
  hardware: hw, localModels: ['qwen3:14b'],
};
const model = (id: string) => LOCAL_MODELS.find((m) => m.id === id)!;
const st = (over: Partial<OnboardingState>): OnboardingState => ({ ...INITIAL_STATE, report: partial, ...over });

describe('depRows', () => {
  it('insere o modelo logo depois do Ollama, com o tamanho do catálogo quando falta', () => {
    const rows = depRows(partial, 'misto', 'gpt-oss:20b');
    expect(rows.map((r) => r.id)).toEqual(['node', 'sdk', 'adb', 'emu', 'img', 'kvm', 'ollama', 'model', 'keyring']);
    expect(rows[7]).toMatchObject({ id: 'model', state: 'todo', sizeMb: 14000 });
  });
  it('modelo já baixado fica ok', () => {
    expect(depRows(partial, 'local', 'qwen3:14b').find((r) => r.id === 'model')).toMatchObject({ state: 'ok', version: 'qwen3:14b' });
  });
  it('só nuvem tira Ollama e modelo', () => {
    expect(depRows(partial, 'nuvem', 'gpt-oss:20b').map((r) => r.id)).not.toContain('ollama');
    expect(depRows(partial, 'nuvem', 'gpt-oss:20b').map((r) => r.id)).not.toContain('model');
  });
});

describe('summarize e jobsToInstall', () => {
  it('conta estados e soma o download', () => {
    const rows = depRows(partial, 'misto', 'gpt-oss:20b');
    expect(summarize(rows)).toEqual({ total: 9, ok: 7, todo: 2, user: 0, downloadMb: 15600 });
    expect(jobsToInstall(rows)).toEqual(['img', 'model']);
  });
});

describe('hardware', () => {
  it('capacidade pelo menor entre CPU (4 threads) e RAM (4,6 GB)', () => {
    expect(emulatorCapacity(hw)).toEqual({ count: 8, limit: 'cpu' });
    expect(emulatorCapacity({ ...hw, ramGiB: 16 })).toEqual({ count: 3, limit: 'ram' });
    expect(emulatorCapacity({ ...hw, threads: 0 })).toEqual({ count: 0, limit: 'cpu' });
  });
  it('encaixe do modelo na placa', () => {
    expect(modelFit(model('gpt-oss:20b'), rtx)).toBe('fits');
    expect(modelFit(model('qwen3:32b'), rtx)).toBe('too-big');
    expect(modelFit(model('qwen3:32b'), { name: 'x', totalGiB: 26 })).toBe('tight');
    expect(modelFit(model('gpt-oss:20b'), null)).toBe('cpu');
  });
  it('padrões: com GPU misto e o recomendado; sem GPU só nuvem; placa pequena pega o maior que cabe', () => {
    expect(defaultMode(rtx)).toBe('misto');
    expect(defaultMode(null)).toBe('nuvem');
    expect(defaultModel(rtx)).toBe('gpt-oss:20b');
    expect(defaultModel({ name: 'x', totalGiB: 16 })).toBe('qwen3:14b');
    expect(defaultModel(null)).toBe('gpt-oss:20b');
  });
  it('barra de VRAM', () => {
    const b = vramBar(model('gpt-oss:20b'), rtx)!;
    expect(b.systemPct).toBeCloseTo(5);
    expect(b.modelPct).toBeCloseTo(66.67, 1);
    expect(b.freeGiB).toBe(6.8);
    expect(vramBar(model('gpt-oss:20b'), null)).toBeNull();
  });
});

describe('installTotals', () => {
  it('soma o que foi baixado e diz se falhou ou terminou', () => {
    const t = installTotals(['img', 'model'], {
      img: { id: 'img', state: 'done', doneMb: 1600, totalMb: 1600, error: null },
      model: { id: 'model', state: 'err', doneMb: 8540, totalMb: 14000, error: { kind: 'disk-full', message: 'sem espaço' } },
    }, { img: 1600, model: 14000 });
    expect(t).toEqual({ doneMb: 10140, totalMb: 15600, doneCount: 1, count: 2, failed: true, allDone: false });
  });
  it('item sem evento ainda conta pelo tamanho estimado', () => {
    expect(installTotals(['img'], {}, { img: 1600 })).toEqual({ doneMb: 0, totalMb: 1600, doneCount: 0, count: 1, failed: false, allDone: false });
    expect(installTotals([], {}, {}).allDone).toBe(true);
  });
});

describe('formatMb e ipcErrorText', () => {
  it('MB até 1000, GB depois, no formato do idioma', () => {
    expect(formatMb(14, PT)).toBe('14 MB');
    expect(formatMb(15600, PT)).toBe('15,6 GB');
    expect(formatMb(15600, createI18n('en'))).toBe('15.6 GB');
  });
  it('tira o prefixo do Electron', () => {
    expect(ipcErrorText(new Error("Error invoking remote method 'enxame:setup:finish': Error: daemon não respondeu em 15 s"))).toBe('daemon não respondeu em 15 s');
    expect(ipcErrorText('x')).toBe('x');
  });
});

describe('footerView', () => {
  it('passo 1: bloqueia com item que precisa de você; senão diz quantos itens vêm', () => {
    const needs = { ...partial, deps: partial.deps.map((d) => (d.id === 'kvm' ? dep('kvm', 'user', { fix: 'kvm-group' }) : d)) };
    expect(footerView(st({ report: needs }), PT)).toMatchObject({ disabled: true, hint: 'Resolva o item marcado para continuar' });
    expect(footerView(st({ model: 'gpt-oss:20b' }), PT)).toMatchObject({ disabled: false, action: 'Continuar', hint: 'Itens para instalar no próximo passo: 2' });
    expect(footerView(st({ report: null, checking: true }), PT)).toMatchObject({ disabled: true, hint: 'Verificando a máquina…' });
  });
  it('passo 2: Instalar com o download; aviso de disco curto; modelo que não cabe bloqueia', () => {
    expect(footerView(st({ step: 1, model: 'gpt-oss:20b' }), PT)).toMatchObject({ action: 'Instalar', hint: '15,6 GB de download', disabled: false });
    const lowDisk = { ...partial, hardware: { ...hw, diskFreeGiB: 10 } };
    expect(footerView(st({ step: 1, report: lowDisk, model: 'gpt-oss:20b' }), PT).hint).toBe('15,6 GB de download, mas só 10,0 GB livres em disco');
    expect(footerView(st({ step: 1, model: 'qwen3:32b' }), PT).disabled).toBe(true);
  });
  it('passo 3: espera terminar; erro bloqueia; tudo pronto libera; configurando bloqueia', () => {
    const running = st({ step: 2, model: 'qwen3:14b', installing: true, jobs: { img: { id: 'img', state: 'run', doneMb: 800, totalMb: 1600, error: null } } });
    expect(footerView(running, PT)).toMatchObject({ disabled: true, hint: 'Instalando…', backDisabled: true });
    const failed = st({ step: 2, model: 'qwen3:14b', jobs: { img: { id: 'img', state: 'err', doneMb: 800, totalMb: 1600, error: { kind: 'network', message: 'x' } } } });
    expect(footerView(failed, PT)).toMatchObject({ disabled: true, hint: 'A instalação parou. Veja o aviso acima.' });
    const done = st({ step: 2, model: 'qwen3:14b', jobs: { img: { id: 'img', state: 'done', doneMb: 1600, totalMb: 1600, error: null } } });
    expect(footerView(done, PT)).toMatchObject({ disabled: false, hint: 'Instalação concluída' });
    expect(footerView({ ...done, finishing: true }, PT)).toMatchObject({ disabled: true, action: 'Configurando…' });
    expect(footerView({ ...done, finishError: '409' }, PT)).toMatchObject({ disabled: false, hint: 'Não deu para configurar os papéis: 409' });
  });
  it('passo 4: abre o Cockpit, sem Voltar', () => {
    expect(footerView(st({ step: 3 }), PT)).toMatchObject({ action: 'Abrir o Cockpit', showBack: false, disabled: false });
  });
});
```

`src/onboarding/reducer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { INITIAL_STATE, onboardingReducer } from './reducer';
import type { SetupReport } from './schema';

const report = (gpu: SetupReport['hardware']['gpu']): SetupReport => ({ deps: [], hardware: { ramGiB: 64, threads: 32, cpuModel: 'x', gpu, diskFreeGiB: 100 }, localModels: [] });

describe('onboardingReducer', () => {
  it('check-done escolhe modo e modelo padrão pelo hardware, sem sobrescrever o que a pessoa escolheu', () => {
    const s1 = onboardingReducer(INITIAL_STATE, { type: 'check-done', report: report(null) });
    expect([s1.mode, s1.model, s1.checking]).toEqual(['nuvem', 'gpt-oss:20b', false]);
    const touched = onboardingReducer(onboardingReducer(INITIAL_STATE, { type: 'pick-mode', mode: 'local' }), { type: 'pick-model', model: 'qwen3:14b' });
    const s2 = onboardingReducer(touched, { type: 'check-done', report: report({ name: 'x', totalGiB: 24 }) });
    expect([s2.mode, s2.model]).toEqual(['local', 'qwen3:14b']);
  });
  it('pick-model ignora modelo que não cabe na placa', () => {
    const s = onboardingReducer(INITIAL_STATE, { type: 'check-done', report: report({ name: 'x', totalGiB: 24 }) });
    expect(onboardingReducer(s, { type: 'pick-model', model: 'gpt-oss:120b' }).model).toBe('gpt-oss:20b');
  });
  it('trocar a chave zera o teste', () => {
    const tested = onboardingReducer(onboardingReducer(INITIAL_STATE, { type: 'key-test-start' }), { type: 'key-test-done', result: 'ok' });
    expect(tested.keyTest).toBe('ok');
    expect(onboardingReducer(tested, { type: 'set-key', key: 'sk-ant-y' }).keyTest).toBe('idle');
  });
  it('eventos de job substituem o anterior; install-start limpa o erro', () => {
    const e1 = onboardingReducer(INITIAL_STATE, { type: 'job', event: { id: 'img', state: 'err', doneMb: 1, totalMb: 2, error: { kind: 'network', message: 'x' } } });
    const e2 = onboardingReducer({ ...e1, installError: 'y' }, { type: 'install-start' });
    expect([e2.installing, e2.installError]).toEqual([true, null]);
    const e3 = onboardingReducer(e2, { type: 'job', event: { id: 'img', state: 'run', doneMb: 1.5, totalMb: 2, error: null } });
    expect(e3.jobs.img?.state).toBe('run');
  });
  it('log guarda só as últimas 200 linhas', () => {
    let s = INITIAL_STATE;
    for (let i = 0; i < 250; i++) s = onboardingReducer(s, { type: 'log', line: `l${i}` });
    expect(s.log).toHaveLength(200);
    expect(s.log[0]).toBe('l50');
  });
  it('finish-done vai para o passo 4', () => {
    const s = onboardingReducer({ ...INITIAL_STATE, step: 2, finishing: true }, { type: 'finish-done' });
    expect([s.step, s.finishing]).toEqual([3, false]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --project renderer src/onboarding`
Expected: FAIL — módulos não existem.

- [ ] **Step 3: Implementar `src/onboarding/schema.ts` e `catalog.ts`**

`src/onboarding/schema.ts`:

```ts
import { z } from 'zod';

/** Mesmo formato de electron/setup/types.ts; o renderer valida o que chega do main. */
export const DEP_IDS = ['node', 'sdk', 'adb', 'emu', 'img', 'kvm', 'ollama', 'keyring'] as const;
export const JOB_IDS = ['sdk', 'adb', 'emu', 'img', 'ollama', 'model'] as const;
const ERROR_KINDS = ['disk-full', 'network', 'checksum', 'process'] as const;

export const DepStatusSchema = z.object({
  id: z.enum(DEP_IDS), state: z.enum(['ok', 'todo', 'user']), version: z.string().nullable(), sizeMb: z.number().nullable(),
  fix: z.enum(['node-missing', 'kvm-group', 'kvm-bios', 'keyring-locked']).nullable(),
});
export const HardwareSchema = z.object({
  ramGiB: z.number(), threads: z.number().int(), cpuModel: z.string(),
  gpu: z.object({ name: z.string(), totalGiB: z.number() }).nullable(), diskFreeGiB: z.number(),
});
export const SetupReportSchema = z.object({ deps: z.array(DepStatusSchema), hardware: HardwareSchema, localModels: z.array(z.string()) });
export const JobEventSchema = z.object({
  id: z.enum(JOB_IDS), state: z.enum(['wait', 'run', 'done', 'err']), doneMb: z.number(), totalMb: z.number(),
  error: z.object({ kind: z.enum(ERROR_KINDS), message: z.string() }).nullable(),
});
export const SetupStatusSchema = z.object({ completed: z.boolean(), supported: z.boolean() });
export const KeyTestSchema = z.object({ result: z.enum(['ok', 'invalid', 'network']) });

export type DepStatus = z.infer<typeof DepStatusSchema>;
export type DepId = DepStatus['id'];
export type UserFix = NonNullable<DepStatus['fix']>;
export type Hardware = z.infer<typeof HardwareSchema>;
export type Gpu = Hardware['gpu'];
export type SetupReport = z.infer<typeof SetupReportSchema>;
export type JobEvent = z.infer<typeof JobEventSchema>;
export type JobId = JobEvent['id'];
export type KeyTestResult = z.infer<typeof KeyTestSchema>['result'];
```

`src/onboarding/catalog.ts`:

```ts
import type { MessageKey } from '../i18n/messages';

export type SetupMode = 'misto' | 'local' | 'nuvem';
export const MODES: readonly SetupMode[] = ['misto', 'local', 'nuvem'];
export type RoleWhere = 'cloud' | 'local';
/** Onde cada papel (líder, agentes, escalada) roda em cada modo; igual a electron/setup/apply.ts. */
export const MODE_ROLES: Readonly<Record<SetupMode, readonly [RoleWhere, RoleWhere, RoleWhere]>> = {
  misto: ['cloud', 'local', 'cloud'], local: ['local', 'local', 'local'], nuvem: ['cloud', 'cloud', 'cloud'],
};

export interface ModelEntry { readonly id: string; readonly sizeGb: number; readonly vramGb: number; readonly noteKey: MessageKey; readonly recommended?: boolean }
/** Tamanhos do registro do Ollama; memória de vídeo estimada com o contexto padrão do Enxame (65536). */
export const LOCAL_MODELS: readonly ModelEntry[] = [
  { id: 'gpt-oss:20b', sizeGb: 14, vramGb: 16, noteKey: 'onboarding.model.note.gptoss20', recommended: true },
  { id: 'qwen3:14b', sizeGb: 9.3, vramGb: 13, noteKey: 'onboarding.model.note.qwen14' },
  { id: 'qwen3:32b', sizeGb: 20, vramGb: 24, noteKey: 'onboarding.model.note.qwen32' },
  { id: 'gpt-oss:120b', sizeGb: 65, vramGb: 68, noteKey: 'onboarding.model.note.gptoss120' },
];
export const VRAM_SYSTEM_GIB = 1.2;
/** Mesmos números de src/lib/resources.ts (HOST.ramPerEmulatorGiB, HOST.vcpuPerEmulator). */
export const RAM_PER_EMULATOR_GIB = 4.6;
export const THREADS_PER_EMULATOR = 4;
```

- [ ] **Step 4: Implementar `src/onboarding/reducer.ts`**

```ts
import { LOCAL_MODELS, type SetupMode } from './catalog';
import type { JobEvent, JobId, KeyTestResult, SetupReport } from './schema';
import { defaultMode, defaultModel, modelFit } from './view';

export type Step = 0 | 1 | 2 | 3;
export interface OnboardingState {
  readonly step: Step;
  readonly report: SetupReport | null; readonly checking: boolean; readonly checkError: string | null;
  readonly mode: SetupMode; readonly modeTouched: boolean;
  readonly model: string; readonly modelTouched: boolean;
  readonly apiKey: string; readonly keyTest: 'idle' | 'busy' | KeyTestResult;
  readonly jobs: Readonly<Partial<Record<JobId, JobEvent>>>;
  readonly installing: boolean; readonly installError: string | null;
  readonly finishing: boolean; readonly finishError: string | null;
  readonly log: readonly string[];
}
export type OnboardingAction =
  | { readonly type: 'check-start' } | { readonly type: 'check-done'; readonly report: SetupReport } | { readonly type: 'check-failed'; readonly error: string }
  | { readonly type: 'go'; readonly step: Step }
  | { readonly type: 'pick-mode'; readonly mode: SetupMode } | { readonly type: 'pick-model'; readonly model: string }
  | { readonly type: 'set-key'; readonly key: string }
  | { readonly type: 'key-test-start' } | { readonly type: 'key-test-done'; readonly result: KeyTestResult }
  | { readonly type: 'install-start' } | { readonly type: 'install-failed'; readonly error: string } | { readonly type: 'install-end' }
  | { readonly type: 'job'; readonly event: JobEvent } | { readonly type: 'log'; readonly line: string }
  | { readonly type: 'finish-start' } | { readonly type: 'finish-failed'; readonly error: string } | { readonly type: 'finish-done' };

const MAX_LOG = 200;

export const INITIAL_STATE: OnboardingState = {
  step: 0, report: null, checking: false, checkError: null,
  mode: 'misto', modeTouched: false, model: 'gpt-oss:20b', modelTouched: false,
  apiKey: '', keyTest: 'idle', jobs: {}, installing: false, installError: null,
  finishing: false, finishError: null, log: [],
};

export function onboardingReducer(s: OnboardingState, a: OnboardingAction): OnboardingState {
  switch (a.type) {
    case 'check-start': return { ...s, checking: true, checkError: null };
    case 'check-failed': return { ...s, checking: false, checkError: a.error };
    case 'check-done': {
      const gpu = a.report.hardware.gpu;
      return {
        ...s, checking: false, checkError: null, report: a.report,
        mode: s.modeTouched ? s.mode : defaultMode(gpu),
        model: s.modelTouched ? s.model : defaultModel(gpu),
      };
    }
    case 'go': return { ...s, step: a.step };
    case 'pick-mode': return { ...s, mode: a.mode, modeTouched: true };
    case 'pick-model': {
      const entry = LOCAL_MODELS.find((m) => m.id === a.model);
      if (!entry || (s.report && modelFit(entry, s.report.hardware.gpu) === 'too-big')) return s;
      return { ...s, model: a.model, modelTouched: true };
    }
    case 'set-key': return { ...s, apiKey: a.key, keyTest: 'idle' };
    case 'key-test-start': return { ...s, keyTest: 'busy' };
    case 'key-test-done': return { ...s, keyTest: a.result };
    case 'install-start': return { ...s, installing: true, installError: null };
    case 'install-failed': return { ...s, installError: a.error };
    case 'install-end': return { ...s, installing: false };
    case 'job': return { ...s, jobs: { ...s.jobs, [a.event.id]: a.event } };
    case 'log': return { ...s, log: [...s.log, a.line].slice(-MAX_LOG) };
    case 'finish-start': return { ...s, finishing: true, finishError: null };
    case 'finish-failed': return { ...s, finishing: false, finishError: a.error };
    case 'finish-done': return { ...s, finishing: false, step: 3 };
  }
}
```

- [ ] **Step 5: Implementar `src/onboarding/view.ts`**

```ts
import type { I18n } from '../i18n/translate';
import { LOCAL_MODELS, RAM_PER_EMULATOR_GIB, THREADS_PER_EMULATOR, VRAM_SYSTEM_GIB, type ModelEntry, type SetupMode } from './catalog';
import type { OnboardingState } from './reducer';
import { JOB_IDS, type DepId, type DepStatus, type Gpu, type Hardware, type JobEvent, type JobId, type SetupReport, type UserFix } from './schema';

export type RowId = DepId | 'model';
export interface DepRow { readonly id: RowId; readonly state: DepStatus['state']; readonly version: string | null; readonly sizeMb: number | null; readonly fix: UserFix | null }

const round1 = (n: number) => Math.round(n * 10) / 10;
export const needsLocal = (mode: SetupMode) => mode !== 'nuvem';
export const modelEntry = (id: string): ModelEntry | undefined => LOCAL_MODELS.find((m) => m.id === id);

/** Linhas do passo 1: as do main, sem Ollama no modo nuvem, com a linha do modelo escolhido logo depois do Ollama. */
export function depRows(report: SetupReport, mode: SetupMode, model: string): readonly DepRow[] {
  if (!needsLocal(mode)) return report.deps.filter((d) => d.id !== 'ollama');
  const installed = report.localModels.includes(model);
  const modelRow: DepRow = installed
    ? { id: 'model', state: 'ok', version: model, sizeMb: null, fix: null }
    : { id: 'model', state: 'todo', version: null, sizeMb: Math.round((modelEntry(model)?.sizeGb ?? 0) * 1000), fix: null };
  const i = report.deps.findIndex((d) => d.id === 'ollama');
  return [...report.deps.slice(0, i + 1), modelRow, ...report.deps.slice(i + 1)];
}

export interface Summary { readonly total: number; readonly ok: number; readonly todo: number; readonly user: number; readonly downloadMb: number }
export function summarize(rows: readonly DepRow[]): Summary {
  const count = (s: DepRow['state']) => rows.filter((r) => r.state === s).length;
  return { total: rows.length, ok: count('ok'), todo: count('todo'), user: count('user'), downloadMb: rows.reduce((a, r) => a + (r.state === 'todo' ? r.sizeMb ?? 0 : 0), 0) };
}

export function jobsToInstall(rows: readonly DepRow[]): readonly JobId[] {
  return rows.filter((r) => r.state === 'todo' && (JOB_IDS as readonly string[]).includes(r.id)).map((r) => r.id as JobId);
}
export function sizesOf(rows: readonly DepRow[]): Readonly<Partial<Record<JobId, number>>> {
  return Object.fromEntries(rows.filter((r) => r.state === 'todo').map((r) => [r.id, r.sizeMb ?? 0]));
}

export function emulatorCapacity(hw: Hardware): { count: number; limit: 'cpu' | 'ram' } {
  const byCpu = Math.floor(hw.threads / THREADS_PER_EMULATOR);
  const byRam = Math.floor(hw.ramGiB / RAM_PER_EMULATOR_GIB);
  return byCpu <= byRam ? { count: Math.max(0, byCpu), limit: 'cpu' } : { count: Math.max(0, byRam), limit: 'ram' };
}

export type ModelFit = 'fits' | 'tight' | 'too-big' | 'cpu';
export function modelFit(m: ModelEntry, gpu: Gpu): ModelFit {
  if (!gpu) return 'cpu';
  const need = m.vramGb + VRAM_SYSTEM_GIB;
  if (need > gpu.totalGiB) return 'too-big';
  return need > gpu.totalGiB * 0.9 ? 'tight' : 'fits';
}
export function defaultModel(gpu: Gpu): string {
  const fitting = LOCAL_MODELS.filter((m) => modelFit(m, gpu) !== 'too-big');
  const pick = fitting.find((m) => m.recommended) ?? [...fitting].sort((a, b) => b.vramGb - a.vramGb)[0];
  return (pick ?? LOCAL_MODELS[1]).id;
}
export const defaultMode = (gpu: Gpu): SetupMode => (gpu ? 'misto' : 'nuvem');

export interface VramBar { readonly systemPct: number; readonly modelPct: number; readonly freeGiB: number; readonly totalGiB: number }
export function vramBar(m: ModelEntry, gpu: Gpu): VramBar | null {
  if (!gpu) return null;
  const t = gpu.totalGiB;
  const model = Math.max(0, Math.min(m.vramGb, t - VRAM_SYSTEM_GIB));
  return { systemPct: (VRAM_SYSTEM_GIB / t) * 100, modelPct: (model / t) * 100, freeGiB: Math.max(0, round1(t - VRAM_SYSTEM_GIB - m.vramGb)), totalGiB: t };
}

export interface InstallTotals { readonly doneMb: number; readonly totalMb: number; readonly doneCount: number; readonly count: number; readonly failed: boolean; readonly allDone: boolean }
export function installTotals(jobs: readonly JobId[], events: Readonly<Partial<Record<JobId, JobEvent>>>, sizes: Readonly<Partial<Record<JobId, number>>>): InstallTotals {
  const list = jobs.map((id) => ({ id, ev: events[id], size: sizes[id] ?? 0 }));
  const doneCount = list.filter((j) => j.ev?.state === 'done').length;
  return {
    doneMb: list.reduce((a, j) => a + (j.ev?.doneMb ?? 0), 0),
    totalMb: list.reduce((a, j) => a + (j.ev?.totalMb || j.size), 0),
    doneCount, count: list.length,
    failed: list.some((j) => j.ev?.state === 'err'),
    allDone: doneCount === list.length,
  };
}

export function formatMb(mb: number, i18n: I18n): string {
  return mb >= 1000 ? `${i18n.fmt.decimal(mb / 1000)} GB` : `${Math.round(mb)} MB`;
}
const MB_PER_GIB = 1073.74;

/** Tira o "Error invoking remote method '…': Error: " que o Electron põe na frente. */
export function ipcErrorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '');
}

export interface FooterView { readonly action: string; readonly hint: string; readonly disabled: boolean; readonly showBack: boolean; readonly backDisabled: boolean }

export function footerView(s: OnboardingState, i18n: I18n): FooterView {
  const { t } = i18n;
  const base = { showBack: s.step > 0 && s.step < 3, backDisabled: s.step === 0 || s.installing || s.finishing };
  if (!s.report) {
    return { ...base, action: t('onboarding.nav.continue'), disabled: true, hint: s.checkError ? t('onboarding.check.failed', { error: s.checkError }) : t('onboarding.check.loading') };
  }
  const rows = depRows(s.report, s.mode, s.model);
  const sum = summarize(rows);
  const jobs = jobsToInstall(rows);
  if (s.step === 0) {
    if (sum.user > 0) return { ...base, action: t('onboarding.nav.continue'), disabled: true, hint: t('onboarding.hint.needsYou') };
    return { ...base, action: t('onboarding.nav.continue'), disabled: false, hint: jobs.length ? t('onboarding.hint.willInstall', { count: jobs.length }) : t('onboarding.hint.nothing') };
  }
  if (s.step === 1) {
    const entry = modelEntry(s.model);
    const tooBig = needsLocal(s.mode) && (!entry || modelFit(entry, s.report.hardware.gpu) === 'too-big');
    const size = formatMb(sum.downloadMb, i18n);
    const lowDisk = sum.downloadMb > s.report.hardware.diskFreeGiB * MB_PER_GIB;
    const hint = !jobs.length ? t('onboarding.hint.nothing')
      : lowDisk ? t('onboarding.hint.diskLow', { size, free: `${i18n.fmt.decimal(s.report.hardware.diskFreeGiB)} GB` })
      : t('onboarding.hint.download', { size });
    return { ...base, action: jobs.length ? t('onboarding.nav.install') : t('onboarding.nav.continue'), disabled: tooBig, hint };
  }
  if (s.step === 2) {
    if (s.finishing) return { ...base, action: t('onboarding.nav.finishing'), disabled: true, hint: '' };
    const totals = installTotals(jobs, s.jobs, sizesOf(rows));
    const cont = t('onboarding.nav.continue');
    if (s.finishError) return { ...base, action: cont, disabled: false, hint: t('onboarding.hint.finishFailed', { error: s.finishError }) };
    if (totals.failed || s.installError) return { ...base, action: cont, disabled: true, hint: t('onboarding.hint.error') };
    if (totals.allDone && !s.installing) return { ...base, action: cont, disabled: false, hint: t('onboarding.hint.done') };
    return { ...base, action: cont, disabled: true, hint: t('onboarding.hint.installing') };
  }
  return { ...base, action: t('onboarding.nav.finish'), disabled: false, hint: t('onboarding.hint.ready') };
}
```

Nota: `reducer.ts` importa de `view.ts` e `view.ts` importa só o **tipo** `OnboardingState` de `reducer.ts` (`import type`), então não há ciclo em tempo de execução.

- [ ] **Step 6: Tipar a ponte em `src/live/types.ts`**

Depois de `export interface LoginResult …`, acrescentar:

```ts
/** Onboarding (spec onboarding): tudo chega como `unknown` e é validado em src/onboarding/schema.ts. */
export interface SetupBridge {
  readonly status: () => Promise<unknown>;
  readonly check: () => Promise<unknown>;
  readonly install: (req: { readonly jobs: readonly string[]; readonly localModel: string }) => Promise<void>;
  readonly onJob: (cb: (e: unknown) => void) => () => void;
  readonly onLog: (cb: (line: string) => void) => () => void;
  readonly testKey: (key: string) => Promise<unknown>;
  readonly finish: (req: { readonly mode: string; readonly localModel: string; readonly anthropicKey: string | null }) => Promise<void>;
}
```

e dentro de `interface EnxameBridge`, depois de `login?`:

```ts
  /** Onboarding de primeira execução; ausente em preload antigo e no navegador. */
  readonly setup?: SetupBridge;
```

- [ ] **Step 7: Rodar e ver passar**

Run: `npx vitest run --project renderer src/onboarding && npx tsc -b --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/onboarding src/live/types.ts
git commit -m "feat(onboarding): estado e seletores do onboarding no renderer"
```

---

### Task 11: Telas do onboarding

**Files:**
- Create: `src/onboarding/useOnboarding.ts`, `src/onboarding/Onboarding.tsx`, `src/onboarding/CheckStep.tsx`, `src/onboarding/ModelsStep.tsx`, `src/onboarding/InstallStep.tsx`, `src/onboarding/ReadyStep.tsx`, `src/onboarding/Onboarding.css`

**Interfaces:**
- Consumes: Task 10 inteira; `SetupBridge`; `Button`, `Heading`, `Logo` de `src/components`; `useI18n`.
- Produces: `<Onboarding bridge={SetupBridge} onDone={(screen: 'cockpit' | 'ids') => void} />` (usado pela Task 12).

Os componentes não têm teste unitário (o projeto roda vitest em ambiente node, sem DOM; a lógica está nos seletores da Task 10). A verificação visual é a Task 13.

- [ ] **Step 1: Hook `src/onboarding/useOnboarding.ts`**

```ts
import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { SetupBridge } from '../live/types';
import { INITIAL_STATE, onboardingReducer, type OnboardingState, type Step } from './reducer';
import { JobEventSchema, KeyTestSchema, SetupReportSchema } from './schema';
import { depRows, ipcErrorText, jobsToInstall } from './view';

export interface OnboardingActions {
  readonly check: () => Promise<void>;
  readonly go: (step: Step) => void;
  readonly next: () => void;
  readonly pickMode: (mode: OnboardingState['mode']) => void;
  readonly pickModel: (model: string) => void;
  readonly setKey: (key: string) => void;
  readonly testKey: () => Promise<void>;
  readonly install: () => Promise<void>;
}

export function useOnboarding(bridge: SetupBridge): { state: OnboardingState; actions: OnboardingActions } {
  const [state, dispatch] = useReducer(onboardingReducer, INITIAL_STATE);
  const ref = useRef(state);
  ref.current = state;

  const check = useCallback(async () => {
    dispatch({ type: 'check-start' });
    try { dispatch({ type: 'check-done', report: SetupReportSchema.parse(await bridge.check()) }); }
    catch (e) { dispatch({ type: 'check-failed', error: ipcErrorText(e) }); }
  }, [bridge]);

  useEffect(() => { void check(); }, [check]);
  useEffect(() => {
    const offJob = bridge.onJob((raw) => { const p = JobEventSchema.safeParse(raw); if (p.success) dispatch({ type: 'job', event: p.data }); });
    const offLog = bridge.onLog((line) => dispatch({ type: 'log', line }));
    return () => { offJob(); offLog(); };
  }, [bridge]);

  const install = useCallback(async () => {
    const s = ref.current;
    if (!s.report || s.installing) return;
    const jobs = jobsToInstall(depRows(s.report, s.mode, s.model)).filter((id) => s.jobs[id]?.state !== 'done');
    dispatch({ type: 'install-start' });
    try { await bridge.install({ jobs, localModel: s.model }); }
    catch (e) { dispatch({ type: 'install-failed', error: ipcErrorText(e) }); }
    finally { dispatch({ type: 'install-end' }); }
  }, [bridge]);

  const finish = useCallback(async () => {
    const s = ref.current;
    dispatch({ type: 'finish-start' });
    const key = s.mode === 'local' ? '' : s.apiKey.trim();
    try {
      await bridge.finish({ mode: s.mode, localModel: s.model, anthropicKey: key || null });
      dispatch({ type: 'finish-done' });
    } catch (e) { dispatch({ type: 'finish-failed', error: ipcErrorText(e) }); }
  }, [bridge]);

  const go = useCallback((step: Step) => {
    dispatch({ type: 'go', step });
    if (step === 2) void install();
  }, [install]);

  const next = useCallback(() => {
    const s = ref.current.step;
    if (s === 2) void finish();
    else if (s < 2) go((s + 1) as Step);
  }, [finish, go]);

  const testKey = useCallback(async () => {
    dispatch({ type: 'key-test-start' });
    try { dispatch({ type: 'key-test-done', result: KeyTestSchema.parse(await bridge.testKey(ref.current.apiKey.trim())).result }); }
    catch { dispatch({ type: 'key-test-done', result: 'invalid' }); }
  }, [bridge]);

  return {
    state,
    actions: {
      check, go, next, install, testKey,
      pickMode: (mode) => dispatch({ type: 'pick-mode', mode }),
      pickModel: (model) => dispatch({ type: 'pick-model', model }),
      setKey: (key) => dispatch({ type: 'set-key', key }),
    },
  };
}
```

Nota: `testKey` com chave malformada é recusada pelo zod do main (a chamada rejeita) e vira `invalid`, que é a mensagem certa para a pessoa.

- [ ] **Step 2: `src/onboarding/Onboarding.tsx`**

```tsx
import { Button } from '../components/Button';
import { Logo } from '../components/Logo';
import { useI18n } from '../i18n/I18nProvider';
import type { MessageKey } from '../i18n/messages';
import type { SetupBridge } from '../live/types';
import { CheckStep } from './CheckStep';
import { InstallStep } from './InstallStep';
import { ModelsStep } from './ModelsStep';
import { ReadyStep } from './ReadyStep';
import type { Step } from './reducer';
import { useOnboarding } from './useOnboarding';
import { footerView } from './view';
import './Onboarding.css';

const STEPS: readonly { readonly title: MessageKey; readonly sub: MessageKey }[] = [
  { title: 'onboarding.step.check', sub: 'onboarding.step.check.sub' },
  { title: 'onboarding.step.models', sub: 'onboarding.step.models.sub' },
  { title: 'onboarding.step.install', sub: 'onboarding.step.install.sub' },
  { title: 'onboarding.step.ready', sub: 'onboarding.step.ready.sub' },
];

export interface OnboardingProps {
  readonly bridge: SetupBridge;
  readonly onDone: (screen: 'cockpit' | 'ids') => void;
}

/** Onboarding de primeira execução (spec onboarding, mockup design/onboarding.html). */
export function Onboarding({ bridge, onDone }: OnboardingProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const { state, actions } = useOnboarding(bridge);
  const footer = footerView(state, i18n);
  // Só dá para voltar a passos anteriores; o passo 4 só chega pelo fim da instalação.
  const canJump = (i: number) => i < state.step && !state.installing && !state.finishing && state.step < 3;

  return (
    <div className="onb">
      <aside className="onb__rail">
        <div className="onb__logo"><Logo size={28} /><span>Enxame</span></div>
        <ol className="onb__steps">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <button
                type="button"
                className={`onb__step${i < state.step ? ' onb__step--done' : ''}`}
                aria-current={i === state.step ? 'step' : undefined}
                disabled={!canJump(i) && i !== state.step}
                onClick={() => canJump(i) && actions.go(i as Step)}
              >
                <span className="onb__num">{i < state.step ? '✓' : i + 1}</span>
                <span>{t(s.title)}<span className="onb__sub">{t(s.sub)}</span></span>
              </button>
            </li>
          ))}
        </ol>
        <div className="onb__railnote">
          <span>{t('onboarding.rail.firstRun')}</span>
          <span>{t('onboarding.rail.redo')}</span>
        </div>
      </aside>
      <div className="onb__main">
        <div className="onb__content">
          {state.step === 0 && <CheckStep state={state} onRecheck={() => void actions.check()} />}
          {state.step === 1 && <ModelsStep state={state} onMode={actions.pickMode} onModel={actions.pickModel} onKey={actions.setKey} onTestKey={() => void actions.testKey()} />}
          {state.step === 2 && <InstallStep state={state} onRetry={() => void actions.install()} onOtherModel={() => actions.go(1)} />}
          {state.step === 3 && <ReadyStep state={state} onCreate={() => onDone('ids')} />}
        </div>
        <footer className="onb__footer">
          <span className="onb__hint" role="status">{footer.hint}</span>
          <div className="onb__actions">
            {footer.showBack && (
              <Button variant="secondary" disabled={footer.backDisabled} onClick={() => actions.go((state.step - 1) as Step)}>{t('onboarding.nav.back')}</Button>
            )}
            <Button variant="primary" disabled={footer.disabled} onClick={() => (state.step === 3 ? onDone('cockpit') : actions.next())}>{footer.action}</Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `src/onboarding/CheckStep.tsx`**

```tsx
import { useState } from 'react';
import { Heading } from '../components/Heading';
import { useI18n } from '../i18n/I18nProvider';
import type { MessageKey } from '../i18n/messages';
import type { OnboardingState } from './reducer';
import type { UserFix } from './schema';
import { depRows, emulatorCapacity, formatMb, summarize, type DepRow } from './view';

const KVM_CMD = 'sudo usermod -aG kvm $USER';
const ICON: Readonly<Record<DepRow['state'], string>> = { ok: '✓', todo: '↓', user: '!' };
const PILL: Readonly<Record<DepRow['state'], string>> = { ok: 'pill pill--green', todo: 'pill pill--white', user: 'pill pill--dark' };

function CopyCommand({ cmd }: { readonly cmd: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard?.writeText(cmd).then(() => setCopied(true), () => undefined); };
  return (
    <div className="onb-cmd">
      <code>{cmd}</code>
      <button type="button" className="btn btn--secondary btn--sm" onClick={copy}>{copied ? t('onboarding.fix.copied') : t('onboarding.fix.copy')}</button>
    </div>
  );
}

function Fix({ fix, onRecheck }: { readonly fix: UserFix; readonly onRecheck: () => void }) {
  const { t } = useI18n();
  return (
    <div className="onb-fix">
      <span>{t(`onboarding.fix.${fix}` as MessageKey)}</span>
      {fix === 'kvm-group' && <CopyCommand cmd={KVM_CMD} />}
      <div><button type="button" className="btn btn--secondary btn--sm" onClick={onRecheck}>{t('onboarding.check.retry')}</button></div>
    </div>
  );
}

export function CheckStep({ state, onRecheck }: { readonly state: OnboardingState; readonly onRecheck: () => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const head = (
    <header className="onb-head">
      <Heading size="h2">{t('onboarding.check.title')}</Heading>
      <p className="onb-lede">{t('onboarding.check.lede')}</p>
    </header>
  );
  if (!state.report) {
    return (
      <>
        {head}
        <div className="card card--grey onb-loading">
          {state.checkError ? t('onboarding.check.failed', { error: state.checkError }) : t('onboarding.check.loading')}
          {state.checkError && <div><button type="button" className="btn btn--secondary btn--sm" onClick={onRecheck}>{t('onboarding.check.retry')}</button></div>}
        </div>
      </>
    );
  }
  const rows = depRows(state.report, state.mode, state.model);
  const sum = summarize(rows);
  const hw = state.report.hardware;
  const cap = emulatorCapacity(hw);
  const detail = (r: DepRow) => (r.state === 'ok' ? r.version ?? '' : r.sizeMb ? formatMb(r.sizeMb, i18n) : '');
  const name = (r: DepRow) => t(`onboarding.dep.${r.id}` as MessageKey, { model: state.model });

  return (
    <>
      {head}
      <div className="onb-summary">
        <div className="onb-stat onb-stat--ok"><span className="onb-label">{t('onboarding.summary.ok')}</span><b>{sum.ok}</b><span>{t('onboarding.summary.okOf', { total: sum.total })}</span></div>
        <div className="onb-stat"><span className="onb-label">{t('onboarding.summary.todo')}</span><b>{sum.todo}</b><span>{t('onboarding.summary.download', { size: formatMb(sum.downloadMb, i18n) })}</span></div>
        <div className={`onb-stat${sum.user ? ' onb-stat--user' : ''}`}><span className="onb-label">{t('onboarding.summary.user')}</span><b>{sum.user}</b><span>{sum.user ? t('onboarding.summary.userSome') : t('onboarding.summary.userNone')}</span></div>
      </div>
      <div className="onb-deps">
        {rows.map((r) => (
          <div className="onb-dep" data-s={r.state} key={r.id}>
            <span className="onb-dep__ico" aria-hidden="true">{ICON[r.state]}</span>
            <div><h3>{name(r)}</h3><p>{t(`onboarding.dep.${r.id}.role` as MessageKey)}</p></div>
            <div className="onb-dep__meta"><span className={PILL[r.state]}>{t(`onboarding.state.${r.state}` as MessageKey)}</span><span className="onb-mono">{detail(r)}</span></div>
            {r.state === 'user' && r.fix && <Fix fix={r.fix} onRecheck={onRecheck} />}
          </div>
        ))}
      </div>
      <div className="card card--dark onb-hw">
        <div>
          <span className="onb-label onb-label--dark">{t('onboarding.hw.title')}</span>
          <dl>
            <dt>{t('onboarding.hw.ram')}</dt><dd>{`${i18n.fmt.decimal(hw.ramGiB, 0)} GB`}</dd>
            <dt>{t('onboarding.hw.cpu')}</dt><dd>{t('onboarding.hw.cpuValue', { threads: hw.threads, model: hw.cpuModel })}</dd>
            <dt>{t('onboarding.hw.gpu')}</dt><dd>{hw.gpu ? `${hw.gpu.name} · ${i18n.fmt.decimal(hw.gpu.totalGiB, 0)} GB` : t('onboarding.hw.gpuNone')}</dd>
            <dt>{t('onboarding.hw.disk')}</dt><dd>{`${i18n.fmt.decimal(hw.diskFreeGiB, 0)} GB`}</dd>
          </dl>
        </div>
        <div className="onb-cap">
          <span className="onb-label onb-label--dark">{t('onboarding.hw.capacity')}</span>
          <b>{cap.count}</b>
          <div className="onb-phones" aria-hidden="true">
            {Array.from({ length: Math.max(cap.count, 12) }, (_, i) => <i key={i} className={i < cap.count ? 'on' : ''} />)}
          </div>
          <span className="onb-cap__note">{t('onboarding.hw.capacityNote', { ram: `${i18n.fmt.decimal(4.6)} GB` })} {t(`onboarding.hw.limit.${cap.limit}` as MessageKey)}</span>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: `src/onboarding/ModelsStep.tsx`**

```tsx
import { Heading } from '../components/Heading';
import { useI18n } from '../i18n/I18nProvider';
import type { MessageKey } from '../i18n/messages';
import { LOCAL_MODELS, MODE_ROLES, MODES, type SetupMode } from './catalog';
import type { OnboardingState } from './reducer';
import { modelEntry, modelFit, needsLocal, vramBar } from './view';

const ROLE_KEYS: readonly MessageKey[] = ['onboarding.role.lider', 'onboarding.role.worker', 'onboarding.role.esc'];

export interface ModelsStepProps {
  readonly state: OnboardingState;
  readonly onMode: (m: SetupMode) => void;
  readonly onModel: (id: string) => void;
  readonly onKey: (key: string) => void;
  readonly onTestKey: () => void;
}

export function ModelsStep({ state, onMode, onModel, onKey, onTestKey }: ModelsStepProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const gpu = state.report?.hardware.gpu ?? null;
  const recommended: SetupMode = gpu ? 'misto' : 'nuvem';
  const current = modelEntry(state.model) ?? LOCAL_MODELS[0];
  const bar = vramBar(current, gpu);
  const gb = (n: number) => `${i18n.fmt.decimal(n)} GB`;
  const keyMsg: Partial<Record<OnboardingState['keyTest'], MessageKey>> = { ok: 'onboarding.key.ok', invalid: 'onboarding.key.invalid', network: 'onboarding.key.network' };

  return (
    <>
      <header className="onb-head">
        <Heading size="h2">{t('onboarding.models.title')}</Heading>
        <p className="onb-lede">{t('onboarding.models.lede')}</p>
      </header>
      <div className="onb-modes" role="radiogroup" aria-label={t('onboarding.models.title')}>
        {MODES.map((m) => (
          <button type="button" key={m} role="radio" aria-checked={state.mode === m} className="onb-mode" onClick={() => onMode(m)}>
            {m === recommended ? <span className="pill pill--dark">{t('onboarding.mode.recommended')}</span> : <span className="onb-mode__spacer" />}
            <h3>{t(`onboarding.mode.${m}` as MessageKey)}</h3>
            <p>{t(`onboarding.mode.${m}.text` as MessageKey)}</p>
            <div className="onb-mode__roles">
              {MODE_ROLES[m].map((where, i) => (
                <span className="pill pill--white" key={ROLE_KEYS[i]}>{t(ROLE_KEYS[i])}: {t(where === 'cloud' ? 'onboarding.role.cloud' : 'onboarding.role.local')}</span>
              ))}
            </div>
          </button>
        ))}
      </div>
      <div className={needsLocal(state.mode) ? 'onb-two' : ''}>
        {needsLocal(state.mode) && (
          <div className="card onb-local">
            <span className="onb-label">{t('onboarding.models.localTitle')}</span>
            <div className="onb-models" role="radiogroup" aria-label={t('onboarding.models.localTitle')}>
              {LOCAL_MODELS.map((m) => {
                const fit = modelFit(m, gpu);
                const installed = state.report?.localModels.includes(m.id) ?? false;
                return (
                  <button type="button" key={m.id} role="radio" aria-checked={state.model === m.id} aria-disabled={fit === 'too-big'} className="onb-model" onClick={() => onModel(m.id)}>
                    <span className="onb-radio" aria-hidden="true" />
                    <div>
                      <h4>
                        <span className="onb-mono">{m.id}</span>
                        {m.recommended && <span className="pill pill--green">{t('onboarding.model.recommended')}</span>}
                        {installed && <span className="pill pill--grey">{t('onboarding.model.installed')}</span>}
                        {fit === 'too-big' && <span className="pill pill--grey">{t('onboarding.model.tooBig')}</span>}
                        {fit === 'tight' && <span className="pill pill--grey">{t('onboarding.model.tight')}</span>}
                      </h4>
                      <p>{fit === 'cpu' ? t('onboarding.model.cpu') : t(m.noteKey)}</p>
                    </div>
                    <span className="onb-model__size">{gb(m.sizeGb)}<small>{t('onboarding.model.vram', { size: gb(m.vramGb) })}</small></span>
                  </button>
                );
              })}
            </div>
            {bar && (
              <div className="onb-vram">
                <span className="onb-label">{t('onboarding.vram.title')}</span>
                <div className="onb-vram__bar" aria-hidden="true">
                  <span style={{ width: `${bar.systemPct}%` }} className="onb-vram__sys" />
                  <span style={{ width: `${bar.modelPct}%` }} className="onb-vram__model" />
                </div>
                <div className="onb-vram__legend">
                  <span><i className="onb-vram__sys" />{t('onboarding.vram.system', { size: gb(1.2) })}</span>
                  <span><i className="onb-vram__model" />{t('onboarding.vram.model', { model: current.id, size: gb(current.vramGb) })}</span>
                  <span><i />{t('onboarding.vram.free', { free: gb(bar.freeGiB), total: gb(bar.totalGiB) })}</span>
                </div>
              </div>
            )}
          </div>
        )}
        {state.mode === 'local' ? (
          <div className="card card--grey"><p className="onb-note">{t('onboarding.key.localOnly')}</p></div>
        ) : (
          <div className="card card--grey onb-key">
            <label htmlFor="onb-apikey">{t('onboarding.key.label')}</label>
            <input id="onb-apikey" type="password" placeholder="sk-ant-…" autoComplete="off" value={state.apiKey} onChange={(e) => onKey(e.target.value)} />
            <small>{t('onboarding.key.help')}</small>
            <div className="onb-key__row">
              <button type="button" className="btn btn--secondary btn--sm" disabled={!state.apiKey.trim() || state.keyTest === 'busy'} onClick={onTestKey}>
                {state.keyTest === 'busy' ? t('onboarding.key.testing') : t('onboarding.key.test')}
              </button>
              {keyMsg[state.keyTest] && <span role="status" className={state.keyTest === 'ok' ? 'onb-ok' : 'onb-bad'}>{t(keyMsg[state.keyTest]!)}</span>}
            </div>
            {!state.apiKey.trim() && <small>{t('onboarding.key.empty')}</small>}
          </div>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 5: `src/onboarding/InstallStep.tsx`**

```tsx
import { Heading } from '../components/Heading';
import { useI18n } from '../i18n/I18nProvider';
import type { MessageKey } from '../i18n/messages';
import type { OnboardingState } from './reducer';
import type { JobEvent, JobId } from './schema';
import { depRows, formatMb, installTotals, jobsToInstall, sizesOf } from './view';

const PILL: Readonly<Record<JobEvent['state'], string>> = { wait: 'pill pill--grey', run: 'pill pill--white', done: 'pill pill--green', err: 'pill onb-pill--err' };

export interface InstallStepProps { readonly state: OnboardingState; readonly onRetry: () => void; readonly onOtherModel: () => void }

export function InstallStep({ state, onRetry, onOtherModel }: InstallStepProps) {
  const i18n = useI18n();
  const { t } = i18n;
  if (!state.report) return null;
  const rows = depRows(state.report, state.mode, state.model);
  const jobs = jobsToInstall(rows);
  const sizes = sizesOf(rows);
  const totals = installTotals(jobs, state.jobs, sizes);
  const nameOf = (id: JobId) => t(`onboarding.dep.${id}` as MessageKey, { model: state.model });

  return (
    <>
      <header className="onb-head">
        <Heading size="h2">{t('onboarding.install.title')}</Heading>
        <p className="onb-lede">{t('onboarding.install.lede')}</p>
      </header>
      <div className="onb-total">
        <b>{formatMb(totals.doneMb, i18n)}</b>
        <span>{t('onboarding.install.of', { total: formatMb(totals.totalMb, i18n), done: totals.doneCount, count: totals.count })}</span>
      </div>
      {jobs.length === 0 && <div className="card card--grey">{t('onboarding.install.nothing')}</div>}
      <div className="onb-jobs">
        {jobs.map((id) => {
          const ev: JobEvent = state.jobs[id] ?? { id, state: 'wait', doneMb: 0, totalMb: sizes[id] ?? 0, error: null };
          const total = ev.totalMb || sizes[id] || 0;
          const pct = total ? Math.min(100, (ev.doneMb / total) * 100) : 0;
          return (
            <div className="onb-job" data-s={ev.state} key={id}>
              <div className="onb-job__top"><h3>{nameOf(id)}</h3><span className={PILL[ev.state]}>{t(`onboarding.job.${ev.state}` as MessageKey)}</span></div>
              <div className="onb-prog" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /></div>
              <div className="onb-job__top">
                <span className="onb-nums">{t('onboarding.job.progress', { done: formatMb(ev.doneMb, i18n), total: formatMb(total, i18n) })}</span>
                {id === 'ollama' && ev.state !== 'done' && <span className="onb-nums">{t('onboarding.install.ollamaNote')}</span>}
              </div>
              {ev.state === 'err' && ev.error && (
                <div className="onb-err">
                  <strong>{t(`onboarding.err.${ev.error.kind}.title` as MessageKey)}</strong>
                  <p>{t(`onboarding.err.${ev.error.kind}` as MessageKey, { message: ev.error.message })}</p>
                  <div className="onb-err__row">
                    <button type="button" className="btn btn--primary btn--sm" onClick={onRetry}>{t('onboarding.err.retry')}</button>
                    {id === 'model' && <button type="button" className="btn btn--secondary btn--sm" onClick={onOtherModel}>{t('onboarding.err.otherModel')}</button>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {state.installError && <div className="onb-err"><p>{state.installError}</p><div><button type="button" className="btn btn--primary btn--sm" onClick={onRetry}>{t('onboarding.err.retry')}</button></div></div>}
      <details className="onb-details">
        <summary>{t('onboarding.install.details')}</summary>
        <pre className="onb-log">{state.log.join('\n')}</pre>
      </details>
    </>
  );
}
```

- [ ] **Step 6: `src/onboarding/ReadyStep.tsx`**

```tsx
import { Heading } from '../components/Heading';
import { useI18n } from '../i18n/I18nProvider';
import type { MessageKey } from '../i18n/messages';
import type { OnboardingState } from './reducer';
import { needsLocal } from './view';

export function ReadyStep({ state, onCreate }: { readonly state: OnboardingState; readonly onCreate: () => void }) {
  const { t } = useI18n();
  const items = [
    t('onboarding.ready.android'),
    t('onboarding.ready.kvm'),
    needsLocal(state.mode) ? t('onboarding.ready.local', { model: state.model }) : t('onboarding.ready.cloud'),
    t('onboarding.ready.mode', { mode: t(`onboarding.mode.${state.mode}` as MessageKey) }),
    t('onboarding.ready.keyring'),
  ];
  return (
    <>
      <header className="onb-head">
        <Heading size="h2">{t('onboarding.ready.title')}</Heading>
        <p className="onb-lede">{t('onboarding.ready.lede')}</p>
      </header>
      <div className="onb-ready">
        <div className="card card--grey">
          <span className="onb-label">{t('onboarding.ready.done')}</span>
          <ul className="onb-checklist">{items.map((i) => <li key={i}>{i}</li>)}</ul>
        </div>
        <div className="card card--dark card--shadow onb-next">
          <span className="onb-label onb-label--green">{t('onboarding.ready.next')}</span>
          <h3>{t('onboarding.ready.nextTitle')}</h3>
          <p>{t('onboarding.ready.nextText')}</p>
          <div><button type="button" className="btn btn--tertiary" onClick={onCreate}>{t('onboarding.ready.create')}</button></div>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 7: `src/onboarding/Onboarding.css`**

Transcrição do CSS do mockup (`design/onboarding.html`) para os tokens do app. Usa só variáveis de `src/styles/tokens.css`.

```css
/* Onboarding (spec onboarding): mesmo desenho do mockup design/onboarding.html, com os tokens do app. */
.onb { display: grid; grid-template-columns: var(--sidebar-width) 1fr; min-height: 100vh; background: var(--color-white); }
.onb__rail { background: var(--color-dark); color: var(--color-white); padding: 28px 18px; display: flex; flex-direction: column; gap: 32px; position: sticky; top: 0; height: 100vh; }
.onb__logo { display: flex; align-items: center; gap: 10px; padding: 0 10px; font-size: 26px; font-weight: var(--weight-medium); letter-spacing: -0.5px; }
.onb__steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.onb__step { width: 100%; display: flex; gap: 12px; align-items: center; text-align: left; border: 0; border-radius: var(--radius-control); padding: 12px 14px; background: transparent; color: var(--color-white); font-size: 17px; line-height: 1.3; }
.onb__step:not(:disabled):hover { outline: 1px solid var(--color-green); }
.onb__step:disabled { cursor: default; }
.onb__step[aria-current='step'] { background: var(--color-green); color: var(--color-black); }
.onb__num { width: 28px; height: 28px; flex: none; border-radius: 50%; border: 1px solid var(--color-grey-2); display: grid; place-items: center; font-size: 14px; font-variant-numeric: tabular-nums; }
.onb__step[aria-current='step'] .onb__num { border-color: var(--color-black); }
.onb__step--done .onb__num { background: var(--color-green); color: var(--color-black); border-color: var(--color-green); }
.onb__sub { display: block; font-size: 13px; color: var(--color-grey-2); }
.onb__step[aria-current='step'] .onb__sub { color: var(--color-dark-2); }
.onb__railnote { margin-top: auto; background: var(--color-dark-2); border-radius: var(--radius-control); padding: 16px; font-size: 14px; line-height: 1.4; color: var(--color-grey-2); display: flex; flex-direction: column; gap: 6px; }

.onb__main { display: flex; flex-direction: column; min-width: 0; }
.onb__content { flex: 1; padding: 40px 48px 32px; display: flex; flex-direction: column; gap: 28px; max-width: 1040px; width: 100%; line-height: 1.4; font-size: 16px; }
.onb__footer { position: sticky; bottom: 0; display: flex; flex-wrap: wrap; gap: 12px 20px; align-items: center; justify-content: space-between; padding: 16px 48px; border-top: 1px solid var(--color-dark); background: var(--color-white); }
.onb__hint { color: var(--color-dark-2); font-size: 15px; }
.onb__actions { display: flex; gap: 10px; }
.onb__actions .btn:disabled { opacity: 0.4; cursor: not-allowed; }

.onb-head { display: flex; flex-direction: column; gap: 14px; }
.onb-lede { max-width: 62ch; font-size: 18px; line-height: 1.45; color: var(--color-dark-2); }
.onb-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-dark-2); }
.onb-label--dark { color: var(--color-grey-2); }
.onb-label--green { color: var(--color-green); }
.onb-mono { font-family: var(--font-mono); font-size: 13px; }
.onb-loading { gap: 12px; }
.onb-note { line-height: 1.45; }

.onb-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.onb-stat { border: 1px solid var(--color-dark); border-radius: 22px; padding: 18px 22px; display: flex; flex-direction: column; gap: 4px; }
.onb-stat b { font-size: 34px; font-weight: var(--weight-medium); font-variant-numeric: tabular-nums; }
.onb-stat--ok { background: var(--color-green); }
.onb-stat--user { background: var(--color-dark); color: var(--color-white); }
.onb-stat--user .onb-label { color: var(--color-grey-2); }

.onb-deps { display: flex; flex-direction: column; border: 1px solid var(--color-dark); border-radius: 26px; overflow: hidden; }
.onb-dep { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 4px 16px; align-items: start; padding: 18px 24px; }
.onb-dep + .onb-dep { border-top: 1px solid var(--color-grey-2); }
.onb-dep__ico { width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--color-dark); display: grid; place-items: center; font-size: 15px; }
.onb-dep[data-s='ok'] .onb-dep__ico { background: var(--color-green); }
.onb-dep[data-s='user'] .onb-dep__ico { background: var(--color-dark); color: var(--color-white); }
.onb-dep h3 { margin: 0; font-size: 18px; font-weight: var(--weight-medium); }
.onb-dep p { margin-top: 2px; color: var(--color-dark-2); font-size: 15px; }
.onb-dep__meta { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; text-align: right; }
.onb-fix { grid-column: 2 / -1; margin-top: 10px; background: var(--color-grey); border-radius: var(--radius-control); padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
.onb-cmd { display: flex; gap: 10px; align-items: center; background: var(--color-dark); color: var(--color-green); border-radius: 10px; padding: 10px 12px; overflow-x: auto; }
.onb-cmd code { flex: 1; white-space: nowrap; font-family: var(--font-mono); font-size: 13px; }

.onb-hw { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); gap: 24px; align-items: center; }
.onb-hw dl { margin: 8px 0 0; display: grid; grid-template-columns: auto 1fr; gap: 6px 16px; font-variant-numeric: tabular-nums; }
.onb-hw dt { color: var(--color-grey-2); }
.onb-hw dd { margin: 0; }
.onb-cap { display: flex; flex-direction: column; gap: 10px; }
.onb-cap b { font-size: 56px; font-weight: var(--weight-medium); line-height: 1; color: var(--color-green); font-variant-numeric: tabular-nums; }
.onb-cap__note { color: var(--color-grey-2); font-size: 14px; }
.onb-phones { display: flex; flex-wrap: wrap; gap: 6px; }
.onb-phones i { width: 16px; height: 26px; border: 1.5px solid var(--color-green); border-radius: 4px; }
.onb-phones i.on { background: var(--color-green); }

.onb-modes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.onb-mode { text-align: left; border: 1px solid var(--color-dark); border-radius: 26px; padding: 22px; background: var(--color-white); color: var(--color-black); display: flex; flex-direction: column; gap: 10px; line-height: 1.4; }
.onb-mode:hover { background: var(--color-grey); }
.onb-mode[aria-checked='true'] { background: var(--color-green); box-shadow: var(--shadow-card); }
.onb-mode h3 { margin: 0; font-size: 20px; font-weight: var(--weight-medium); }
.onb-mode p { font-size: 15px; color: var(--color-dark-2); }
.onb-mode__spacer { height: 22px; }
.onb-mode__roles { display: flex; flex-wrap: wrap; gap: 6px; margin-top: auto; }
.onb-two { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 24px; align-items: start; }
.onb-local { gap: 18px; }
.onb-models { display: flex; flex-direction: column; gap: 10px; }
.onb-model { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; gap: 14px; align-items: center; border: 1px solid var(--color-dark); border-radius: 18px; padding: 14px 18px; background: var(--color-white); color: var(--color-black); text-align: left; line-height: 1.35; }
.onb-model[aria-checked='true'] { outline: 3px solid var(--color-dark); outline-offset: -1px; }
.onb-model[aria-disabled='true'] { opacity: 0.5; cursor: not-allowed; }
.onb-radio { width: 22px; height: 22px; border-radius: 50%; border: 1.5px solid var(--color-dark); display: grid; place-items: center; }
.onb-model[aria-checked='true'] .onb-radio::after { content: ''; width: 12px; height: 12px; border-radius: 50%; background: var(--color-dark); }
.onb-model h4 { margin: 0; font-size: 17px; font-weight: var(--weight-medium); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.onb-model p { margin-top: 2px; font-size: 14px; color: var(--color-dark-2); }
.onb-model__size { text-align: right; font-variant-numeric: tabular-nums; font-size: 15px; display: flex; flex-direction: column; }
.onb-model__size small { color: var(--color-dark-2); font-size: 13px; }
.onb-vram { display: flex; flex-direction: column; gap: 8px; }
.onb-vram__bar { height: 22px; border: 1px solid var(--color-dark); border-radius: 8px; background: var(--color-white); display: flex; overflow: hidden; }
.onb-vram__sys { background: var(--color-grey-2); }
.onb-vram__model { background: var(--color-green); }
.onb-vram__legend { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 14px; color: var(--color-dark-2); font-variant-numeric: tabular-nums; }
.onb-vram__legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; border: 1px solid var(--color-dark); margin-right: 6px; vertical-align: -1px; }
.onb-key { gap: 8px; }
.onb-key label { font-weight: var(--weight-medium); }
.onb-key input { border: 1px solid var(--color-dark); border-radius: var(--radius-control); padding: 13px 16px; background: var(--color-white); width: 100%; font-size: 16px; }
.onb-key small { color: var(--color-dark-2); font-size: 14px; line-height: 1.4; }
.onb-key__row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.onb-ok { font-size: 14px; }
.onb-bad { font-size: 14px; color: var(--color-danger); }

.onb-total { display: flex; flex-wrap: wrap; gap: 10px 28px; align-items: baseline; }
.onb-total b { font-size: 44px; font-weight: var(--weight-medium); font-variant-numeric: tabular-nums; }
.onb-total span { color: var(--color-dark-2); }
.onb-jobs { display: flex; flex-direction: column; gap: 12px; }
.onb-job { border: 1px solid var(--color-dark); border-radius: 22px; padding: 18px 22px; display: flex; flex-direction: column; gap: 12px; }
.onb-job[data-s='err'] { border-color: var(--color-danger); box-shadow: 0 5px 0 0 var(--color-danger); }
.onb-job__top { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; justify-content: space-between; }
.onb-job h3 { margin: 0; font-size: 18px; font-weight: var(--weight-medium); }
.onb-nums { font-variant-numeric: tabular-nums; color: var(--color-dark-2); font-size: 14px; }
.onb-prog { height: 14px; border: 1px solid var(--color-dark); border-radius: 7px; overflow: hidden; background: var(--color-grey); }
.onb-prog span { display: block; height: 100%; background: var(--color-green); transition: width 0.6s ease; }
.onb-job[data-s='err'] .onb-prog span { background: var(--color-danger); }
.onb-job[data-s='wait'] .onb-prog { border-style: dashed; border-color: var(--color-grey-2); }
.onb-pill--err { background: var(--color-danger); border-color: var(--color-danger); color: var(--color-white); }
.onb-err { background: #fbeceb; border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; color: var(--color-danger); }
.onb-err p { color: var(--color-black); line-height: 1.4; }
.onb-err__row { display: flex; flex-wrap: wrap; gap: 8px; }
.onb-details summary { cursor: pointer; font-weight: var(--weight-medium); margin-bottom: 10px; }
.onb-log { margin: 0; background: var(--color-dark); color: var(--color-grey-2); border-radius: 22px; padding: 18px 22px; font-family: var(--font-mono); font-size: 12.5px; line-height: 1.6; max-height: 220px; overflow: auto; white-space: pre-wrap; }

.onb-ready { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; }
.onb-checklist { list-style: none; margin: 14px 0 0; padding: 0; display: flex; flex-direction: column; gap: 10px; line-height: 1.4; }
.onb-checklist li::before { content: '✓ '; font-weight: var(--weight-bold); }
.onb-next { gap: 14px; }
.onb-next h3 { margin: 0; font-size: 24px; font-weight: var(--weight-medium); }
.onb-next p { color: var(--color-grey-2); line-height: 1.4; }

@media (max-width: 900px) {
  .onb { grid-template-columns: 1fr; }
  .onb__rail { position: static; height: auto; padding: 16px; gap: 14px; }
  .onb__railnote { display: none; }
  .onb__steps { flex-direction: row; overflow-x: auto; gap: 4px; }
  .onb__step { padding: 8px 10px; font-size: 15px; white-space: nowrap; }
  .onb__sub { display: none; }
  .onb__content { padding: 24px 16px; }
  .onb__footer { padding-inline: 16px; }
  .onb-summary, .onb-modes, .onb-two, .onb-hw, .onb-ready { grid-template-columns: 1fr; }
  .onb-dep { grid-template-columns: 34px minmax(0, 1fr); padding: 16px; }
  .onb-dep__meta { grid-column: 2; align-items: flex-start; text-align: left; flex-direction: row; flex-wrap: wrap; }
  .onb-fix { grid-column: 1 / -1; }
}
@media (prefers-reduced-motion: reduce) { .onb-prog span { transition: none; } }
```

- [ ] **Step 8: Verificar tipos e testes**

Run: `npx tsc -b --noEmit && npx vitest run --project renderer`
Expected: sem erro de tipo; testes verdes.

- [ ] **Step 9: Commit**

```bash
git add src/onboarding
git commit -m "feat(onboarding): telas de verificação, modelos, instalação e pronto"
```

---

### Task 12: Onboarding na subida do app e botão em Provedores

**Files:**
- Create: `src/Root.tsx`
- Modify: `src/main.tsx`, `src/App.tsx`, `src/screens/Providers.tsx`

**Interfaces:**
- Consumes: `Onboarding` (Task 11), `SetupStatusSchema` (Task 10), `providers.setup` (Task 9), `Screen` de `src/types/fleet`.
- Produces: `App` aceita `{ startScreen?: Screen | null; onReopenSetup?: () => void }`; `Providers` aceita `onReopenSetup?: () => void`.

- [ ] **Step 1: `src/Root.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { App } from './App';
import { Onboarding } from './onboarding/Onboarding';
import { SetupStatusSchema } from './onboarding/schema';
import type { Screen } from './types/fleet';

type Phase =
  | { readonly kind: 'loading' }
  | { readonly kind: 'onboarding' }
  | { readonly kind: 'app'; readonly startScreen: Screen | null };

/**
 * Decide entre o onboarding (primeira execução, spec onboarding) e o app. Sem a ponte de setup (navegador, preload
 * antigo) ou se o main não responder, abre o app como antes: o onboarding nunca pode trancar quem já usa o Enxame.
 */
export function Root() {
  const setup = window.enxame?.setup;
  const [phase, setPhase] = useState<Phase>(() => (setup ? { kind: 'loading' } : { kind: 'app', startScreen: null }));

  useEffect(() => {
    if (!setup) return;
    setup.status().then(
      (raw) => {
        const s = SetupStatusSchema.safeParse(raw);
        setPhase(s.success && s.data.supported && !s.data.completed ? { kind: 'onboarding' } : { kind: 'app', startScreen: null });
      },
      () => setPhase({ kind: 'app', startScreen: null }),
    );
  }, [setup]);

  if (phase.kind === 'loading') return null;
  if (phase.kind === 'onboarding' && setup) {
    return <Onboarding bridge={setup} onDone={(screen) => setPhase({ kind: 'app', startScreen: screen })} />;
  }
  return (
    <App
      startScreen={phase.kind === 'app' ? phase.startScreen : null}
      onReopenSetup={setup ? () => setPhase({ kind: 'onboarding' }) : undefined}
    />
  );
}
```

- [ ] **Step 2: `src/main.tsx` monta o `Root`**

Trocar `import { App } from './App';` por `import { Root } from './Root';` e `<App />` por `<Root />`.

- [ ] **Step 3: `src/App.tsx` aceita tela inicial e o atalho de reabrir**

1. Trocar `import { useMemo } from 'react';` por `import { useEffect, useMemo } from 'react';` e acrescentar `import type { Screen } from './types/fleet';` (se ainda não houver import de `Screen`).
2. Trocar `export function App() {` por:

```tsx
export interface AppProps {
  /** Tela para abrir ao sair do onboarding ("Criar identidade" → Identidades). */
  readonly startScreen?: Screen | null;
  /** Provedores → Verificar dependências (reabre o onboarding). */
  readonly onReopenSetup?: () => void;
}

export function App({ startScreen = null, onReopenSetup }: AppProps = {}) {
```

3. Logo depois da linha `const { state, actions, bridged, goal, identity, credentials, mission, settings } = useFleet();`, acrescentar:

```tsx
  // Só na montagem: a tela escolhida no fim do onboarding.
  useEffect(() => { if (startScreen) actions.go(startScreen); }, [startScreen]);
```

4. No `case 'prov':`, passar `onReopenSetup={onReopenSetup}` para `<Providers … />`.

- [ ] **Step 4: Botão em `src/screens/Providers.tsx`**

1. `import { Button } from '../components/Button';`
2. Em `interface ProvidersProps`, acrescentar:

```ts
  /** Reabre o onboarding (spec onboarding); ausente fora do Electron. */
  readonly onReopenSetup?: () => void;
```

3. Acrescentar `onReopenSetup` à desestruturação dos props.
4. Dentro de `<header className="screen__title">`, depois do `<p className="screen__lede">…</p>`, acrescentar:

```tsx
        {onReopenSetup && (
          <div><Button variant="secondary" size="sm" onClick={onReopenSetup}>{t('providers.setup')}</Button></div>
        )}
```

- [ ] **Step 5: Verificar**

Run: `npx tsc -b --noEmit && npm test`
Expected: sem erro de tipo; todos os projetos de teste verdes.

- [ ] **Step 6: Commit**

```bash
git add src/Root.tsx src/main.tsx src/App.tsx src/screens/Providers.tsx
git commit -m "feat(onboarding): onboarding na primeira execução e atalho em Provedores"
```

---

### Task 13: Verificação de ponta a ponta e README

**Files:**
- Modify: `README.md` (seções "Requirements" e "Getting started")

Nada aqui é teste automatizado: é a conferência no app real, em três cenários, sem baixar 17 GB.

- [ ] **Step 1: Build**

Run: `npm run build && npm run daemon:build`
Expected: sem erros.

- [ ] **Step 2: Cenário "instalação existente" (esta máquina)**

```bash
mv ~/.local/share/enxame/setup.json ~/.local/share/enxame/setup.json.bak 2>/dev/null; npx electron --no-sandbox .
```

Expected: o app abre direto no Cockpit (sem onboarding) e `~/.local/share/enxame/setup.json` passa a existir com `completedAt` preenchido e `paths.sdkRoot` = `~/Android/Sdk`. Fechar o app.

- [ ] **Step 3: Cenário "falta pouco" (instalação real e pequena)**

Isolar dados e SDK num diretório temporário, copiando só o que é grande para a imagem não ser baixada de novo:

```bash
T=$(mktemp -d); mkdir -p $T/sdk/system-images && cp -r ~/Android/Sdk/cmdline-tools ~/Android/Sdk/emulator $T/sdk/ && cp -r ~/Android/Sdk/system-images/android-34 $T/sdk/system-images/
ENXAME_DATA_DIR=$T/data ANDROID_HOME=$T/sdk ENXAME_PORT=47811 npx electron --no-sandbox .
```

Expected, em ordem:
1. Onboarding no passo Verificar; "platform-tools (adb)" como "Vamos instalar · 14 MB"; o resto ok.
2. Continuar → Modelos com "Misto" marcado (há GPU) e `gpt-oss:20b` como "Já baixado".
3. Instalar → uma barra (adb) sobe até Concluído; "Ver detalhes técnicos" mostra linhas do sdkmanager.
4. Continuar → "Configurando…" → Pronto. `$T/data/setup.json` tem `completedAt` e `sdkRoot` = `$T/sdk`.
5. "Criar identidade" abre a tela Identidades; Provedores mostra o worker local com `gpt-oss:20b` e o botão "Verificar dependências" reabre o onboarding.

- [ ] **Step 4: Cenário "erro"**

Com o mesmo `$T`, reabrir o onboarding pelo botão de Provedores, desligar a rede (`nmcli networking off`), escolher "Só local" com `qwen3:14b` (não baixado) e Instalar.

Expected: o item do modelo fica "Falhou" com "Sem conexão" e o botão "Continuar download"; o rodapé diz "A instalação parou. Veja o aviso acima." e o Continuar fica desativado. Religar a rede (`nmcli networking on`), clicar "Continuar download": o pull recomeça. Fechar o app antes de terminar para não baixar os 9 GB, e apagar o que ficou: `ollama rm qwen3:14b 2>/dev/null; rm -rf $T`.

- [ ] **Step 5: Restaurar**

Run: `mv ~/.local/share/enxame/setup.json.bak ~/.local/share/enxame/setup.json 2>/dev/null; true`

- [ ] **Step 6: README**

Em "Requirements", trocar a lista do Android SDK e dos modelos por:

```markdown
- **Linux x86_64** with a desktop session and **Node.js 24 or newer** (the daemon uses the built-in `node:sqlite`).
- Everything else is checked on first run. The **setup screen** installs what is missing without `sudo`: the Android SDK
  (with its own Java), platform-tools, the emulator, the **Android 14 (API 34) Google Play x86_64** image, **Ollama**
  and a local model. It asks you to act only when it cannot: your user in the `kvm` group, virtualization in the BIOS,
  or a locked OS keyring. Run the check again any time from **Provedores → Verificar dependências**.
```

Em "Getting started", apagar a linha `cp .env.example .env …` e o aviso sobre caminhos fixos em `daemon/src/config.ts` (o SDK agora vem do `setup.json`, `ANDROID_HOME` ou `~/Android/Sdk`). Manter a menção de que `ANTHROPIC_API_KEY` no `.env` ainda funciona e vence a chave salva pela tela.

- [ ] **Step 7: Rodar tudo e commit**

Run: `npm test && npx tsc -b --noEmit && npm run daemon:build`
Expected: tudo verde.

```bash
git add README.md
git commit -m "docs(onboarding): README com a tela de primeira execução"
```
