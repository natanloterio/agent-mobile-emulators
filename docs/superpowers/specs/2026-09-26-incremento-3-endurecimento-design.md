# Incremento 3 — Endurecimento (minors deferidos da revisão do incremento 2)

**Data:** 2026-09-26 · **Estende:** `2026-09-26-incremento-2-provedor-local-design.md` (§4.5, §4.6, §6) e `2026-09-26-android-swarm-design.md` (§6, §7) · **Base de código:** `master` em `317acb4`

## 1. Objetivo

Fechar os 13 achados deferidos pela revisão final do incremento 2 sem acrescentar funcionalidade além deles. Duas decisões do spec 2 mudam (o piso de qualidade e a edição na tela Provedores); o resto é endurecimento de fluxos existentes.

**Critério de conclusão:** suíte verde; teste de integração com Ollama real verde nesta máquina; na tela real, trocar o modelo do worker pelo seletor, editar o endpoint, ver o erro de um `PUT` inválido na linha do card e ver "degradada" / "encerrou com N sobrando" numa identidade.

## 2. Decisões tomadas no brainstorm

| decisão | escolha | alternativa descartada |
|---|---|---|
| o que o piso passa a contar | tool call fora do schema **+ erro de parâmetro do servidor MCP** | também erros de nó; também parada precoce |
| edição na tela | seletor de modelos (lista do Ollama / lista fixa da nuvem) + endpoint em texto no modo local; erro de `PUT` na linha do card | campos livres; endpoint fixo |
| detecção do erro semântico | padrão de texto do servidor, isolado numa função testada | código estruturado no servidor MCP (fork de terceiro) |
| organização | um incremento, um plano, frentes independentes | dividir daemon / tela em dois incrementos |

## 3. Fatos medidos

- Mensagens de validação do servidor `android-remote-control-mcp` (fonte Kotlin): `Parameter '<nome>' must be one of: …`, `… must be a number[, got: '…']`, `… must be an integer, got: '…'`, `… must be a string`, `… must be non-empty`, `… must not be empty`, `Missing required parameter[:] '<nome>'`. Chegam ao worker embrulhadas como `Error executing tool <tool>: <mensagem>` (o wrapper lança quando o MCP devolve `isError`), portanto aparecem em `tool-error.error`.
- Erros de nó do servidor: `Node '<id>' not found`, `is not clickable`, `is not editable`, `is not scrollable`, `is already visible`, `not visible after N scroll attempts`. **Não contam** (spec 2 §4.5: tela que mudou não é culpa do modelo; o Haiku também erra `node_id`).
- Corrida local do incremento 2: 2 erros de negócio em 17 passos (`scroll` com `amount: '500'` — parâmetro; `scroll_to_node` não visível — nó). Com esta regra, 1 contaria.
- `@ai-sdk/mcp` devolve resultado com `isError` sem lançar; o wrapper do worker lança, o probe não passa pelo wrapper e hoje classifica `isError` como válido.

## 4. Mudanças por área

### 4.1 Piso de qualidade (`daemon/src/provider/quality.ts`) — muda o spec 2 §4.5

`isParamError(text: string): boolean` = `/(?:^|: )(?:Parameter '[^']+' must|Missing required parameter)/`. `observe(step)` soma:

- partes `tool-call` com `invalid: true` (como hoje);
- partes `tool-error` cujo `error` (texto) casa em `isParamError`.

`invalidCallIds(step)` devolve os `toolCallId` dos dois casos, então `recordStep` marca `invalid_call = 1` nessas linhas e o texto do servidor fica em `step.error` como evidência. Limite 3, acumulado por tarefa, inalterado. Fora: negação do gate, erros de nó, erros de infra.

### 4.2 Parada precoce — dado, não gatilho

`RunTaskResult.earlyStopRemaining` (já calculado no bench) passa a vir de `runTask`: `outcome === 'done' ? budget − stepsUsed : 0`. Gravado em `task.early_stop_remaining` (migração idempotente) e exposto no snapshot da identidade ao lado de `genMs` e `degraded`. A tela mostra "17/30 · 33,9 s GPU · encerrou com 13 sobrando" e a tag "degradada".

### 4.3 Probe (`daemon/src/provider/probe.ts`) — três desfechos

| desfecho | `argsValid` | `error` | tela (linha 4) |
|---|---|---|---|
| tool call fora do schema | `false` | `null` | "Argumentos: inválidos" |
| tool executou e o MCP devolveu `isError` | `false` | `MCP: <texto>` | "Erro: MCP: …" |
| tool lançou (device/rede) | `false` | `infra: <texto>` | "Erro: infra: …" |
| leu a tela | `true` | `null` | "Tool: android_<slug>_get_screen_state" |

`at` gravado em `provider_test` é o ISO que o probe devolve (coluna recebe o valor explícito), para o snapshot e a resposta do `POST` coincidirem.

### 4.4 Endurecimentos do daemon

- **`config.ts`:** `endpoint` = `z.string().url()` + refine `http:` ou `https:`; erro de validação do `PUT` vira uma string única legível (`{ error: 'endpoint precisa ser http(s)' }`). `CLOUD_MODELS = ['claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5']` exportado.
- **`ollama.ts`:** só spawna quando o host do endpoint é loopback (`127.0.0.1`, `localhost`, `::1`); endpoint remoto morto → `ProviderError('infra-local', 'endpoint remoto <host>: suba o Ollama lá; o daemon só sobe processo local')`; remoto vivo → conecta, `spawnedByUs=false` (o probe avisa contexto desconhecido). `logPath = path.join(CONFIG.dataDir, 'ollama.log')` com `mkdirSync` antes de abrir; o fd é fechado no `exit`/`error` do filho e no `stop()` (dep `closeLog` injetável).
- **`run.ts`:** `ProviderError('auth')` → identidade `idle` (o device está bem; só a tarefa falha). Orçamento do esc = `budget − stepsUsed` sem `max(1, …)`: se sobrou 0, não há segmento 2, outcome `budget`, `degraded = 0`, e o piso disparado fica no relatório.
- **`db/open.ts`:** `seedProviderConfig(db)` roda uma vez em `openDb`; `readProviderConfig` só lê (banco sem linhas devolve defaults sem inserir); `buildSnapshot` não tem efeito colateral.
- **`api.ts`:** `readJson` antes do check de `inFlight` (fecha o TOCTOU); handler envolto em try/catch → 500 `{ error }`.

### 4.5 API de modelos e tela Provedores — muda o spec 2 §4.6

**`GET /providers/models?role=<papel>`** — leitura pura, sem `inFlight`, sem gravar nada:
- papel em `local` → `GET {ollamaBase(endpoint)}/api/tags` **sem** `ensure` (listar não sobe processo). Vivo → `{ source: 'ollama', models: [...nomes], error: null }`; parado → `{ source: 'ollama', models: [], error: 'Ollama parado — o próximo teste ou objetivo o sobe' }`.
- papel em `nuvem` → `{ source: 'anthropic', models: CLOUD_MODELS, error: null }`.

**Tela (`src/screens/Providers.tsx`)**, mesma estrutura visual, por card:
- toggle Nuvem/Local (como está);
- **Modelo:** `<select>` com as opções de `GET /providers/models`; a opção corrente aparece mesmo fora da lista, marcada "(atual)"; mudar → `PUT { model }`;
- **Endpoint:** modo `local` → `<input>` de texto, `PUT { endpoint }` no blur/Enter; modo `nuvem` → caixa fixa "anthropic";
- **linha de status:** erro do último `PUT` (texto do daemon, 400/409) em vermelho; some no próximo `PUT` bem-sucedido;
- "Testar conexão" e as 4 linhas de resultado como hoje, com a linha 4 da §4.3.
Sem daemon (Vite no browser): select com a lista mock, sem `PUT`.

**Renderer:** `FleetState` ganha `providerErrors: Partial<Record<RoleKey, string>>` e `providerModels: Partial<Record<RoleKey, readonly string[]>>`; ações `setProviderField(role, patch)` (bridge → sucesso limpa erro / falha grava a mensagem) e `loadProviderModels(role)` (ao abrir a tela e após toggle). `liveRoles` continua sobrepondo modo/modelo/endpoint do snapshot; o input de endpoint é controlado só enquanto está em edição.

**Bridge/IPC:** `enxame.getProviderModels(role)` novo; em `electron/main.ts`, `role` validado contra `['lider','worker','esc']` por `providerRoute(role, kind)` (função pura) antes de montar o path; inválido → rejeita localmente.

**Snapshot e telas de identidade:** `IdentitySnapshot` ganha `earlyStopRemaining`; `mergeLive` preenche `task` com sufixo " · degradada" quando `degraded`, e a linha de custo passa a "US$ 0,20 · 33,9 s GPU"; `liveLogFor` mostra `local`/`nuvem` por linha.

### 4.6 Integração e guardas

- **`daemon/test/integration/ollama.integration.test.ts`** (só com `ENXAME_INTEGRATION=1`): pré-condição (emulador em adb 5038 e nenhum daemon vivo) → senão `skip` com motivo. Casos: `ensureOllama` real → `running` e `spawnedByUs || adopted`; `testProvider('worker')` real com `gpt-oss:20b` → `argsValid=true`, `warning=null`, `error=null`; `stop()` → nenhum processo com o marcador em `/proc`.
- **`daemon/src/fleet/lock.ts`:** `daemonAlive(infoPath): { pid } | null`; `bench.ts` e `run-real.ts` recusam com exit 4 quando há daemon vivo ("daemon vivo (PID N) disputa device e Ollama; pare-o ou use a API").

## 5. Modelo de dados (delta)

```sql
alter table task add column early_stop_remaining integer;   -- via applyMigrations, idempotente
```

## 6. Testes

| área | prova |
|---|---|
| `quality` | `isParamError` casa os formatos da §3 e `Missing required parameter`; não casa erros de nó nem ECONNREFUSED; `observe` soma `tool-error` de parâmetro; `recordStep` marca `invalid_call=1` nessas linhas |
| `probe` | três desfechos da §4.3; `at` gravado = devolvido |
| `config` | `ftp:`/`file:`/`javascript:` rejeitados com mensagem única; `http://192.168.1.5:11434/v1` aceito; `CLOUD_MODELS` |
| `ollama` | endpoint não-loopback morto → `infra-local` sem spawn; vivo → conecta sem adoção; `logPath` em `dataDir`; `closeLog` chamado no `stop()` |
| `run` | `auth` → `idle`; piso no último passo → sem segmento 2, `budget`, `degraded=0`; `early_stop_remaining` gravado e em `RunTaskResult` |
| `db/open` | seed em `openDb`; `readProviderConfig` não insere |
| `server` | `GET /providers/models` local com Ollama parado → `models:[]` + `error`; nuvem → `CLOUD_MODELS`; body inválido durante `inFlight` → 409; handler que lança → 500 JSON |
| `electron` | `providerRoute` rejeita papel fora da lista e valores com `?`/`/` |
| `src/live` / `src/state` | `mergeLive` aplica `degraded`/`genMs`/`earlyStopRemaining`; reducer grava/limpa `providerErrors` e `providerModels` |
| `fleet/lock` | PID vivo × morto × arquivo ausente |

Integração: §4.6.

## 7. Notas de spec

- **Default de fábrica só afeta bancos novos.** `PROVIDER_DEFAULTS` é usado no seed; um banco existente mantém a linha do worker que tiver. O registro vivo é a verdade; para reaplicar defaults, `PUT /providers/:role`.
- Spec 2 §4.6 prometia "edição de modelo/endpoint chamam PUT" e a tela não tinha campos; este spec a entrega (§4.5).
- Spec 2 §4.5 passa a contar erro de parâmetro do servidor (§4.1 aqui).

## 8. Fora de escopo

Líder; concorrência de vários workers; mudar a tarefa ou o critério do benchmark; alterar o servidor MCP; código estruturado de erro; reexecutar o bake-off; qualquer item que não esteja na lista dos 13 minors.

## 9. Mapa dos 13 minors → seção

| minor da revisão | onde |
|---|---|
| `url()` aceita `file:`/`javascript:`; spawn fora do loopback | §4.4 |
| `role` sem validação no IPC | §4.5 |
| probe confunde tool que lança / `isError` | §4.3 |
| `budget+1` ao esc | §4.4 |
| `auth` deixa identidade offline | §4.4 |
| `logPath` / fd | §4.4 |
| TOCTOU `inFlight` / handler sem try/catch | §4.4 |
| `at` ISO × SQLite | §4.3 |
| integração real; `genMs`/`degraded` não exibidos | §4.6 / §4.5 |
| piso não vê erro semântico; `earlyStopRemaining` fora do snapshot | §4.1 / §4.2 |
| bench/run-real com daemon vivo | §4.6 |
| seed no snapshot | §4.4 |
| nota "default de fábrica só em banco novo" | §7 |
| (da revisão, §4.6 do spec 2) campos editáveis e erro de `PUT` | §4.5 |

## 10. Resultado (2026-09-26)

**Integração (§4.6) — verde nesta máquina.** Com o daemon parado e o emulador em adb 5038, `ENXAME_INTEGRATION=1 npx vitest run --project daemon daemon/test/integration/ollama.integration.test.ts` passou em 7,2 s: `ensure` subiu um `ollama serve` próprio (nenhum vivo antes), `testProvider('worker')` com `gpt-oss:20b` devolveu `argsValid=true`, `warning=null`, `error=null` com **3539 ms de latência e 29,1 tok/s** (carga do modelo incluída), e depois de `stop()` não restou processo com `OLLAMA_CONTEXT_LENGTH=32768`. Sem a variável: 1 skipped. Desvio do plano: o supervisor recusa spawn sob vitest sem injeção (guarda dos testes unitários), então o teste injeta um `spawn` real explícito.

**Tela real (Electron, `electron .` sobre o Vite de dev, dirigido por Playwright).** A tela ao vivo só ficou alcançável depois de corrigir o shell do Electron no commit `4cbb8b1` (preload emitido como CommonJS para carregar no renderer sandboxed; último snapshot reenviado a cada carga da página). Com isso, `window.enxame` expõe as oito funções da ponte e a tela abre direto no estado do daemon:
- (a) o select do worker lista os modelos do disco do Ollama (`gpt-oss:20b` selecionado, `gemma4:12b` e outros); trocar para `gemma4:12b` persiste — recarregar a página mantém `gemma4:12b`, o que também prova o reenvio do snapshot. Voltou para `gpt-oss:20b`. O atalho Ctrl+R não recarrega (a janela não tem menu, logo não tem o acelerador); a recarga foi feita pelo renderer.
- (b) `ftp://x` no endpoint mostra "endpoint precisa ser http(s)" em vermelho (`rgb(179, 38, 30)`) na linha de erro do card; digitar de volta `http://127.0.0.1:11434/v1` limpa o erro.
- (c) com "Testar conexão" do worker em voo (stand-in de objetivo em execução), clicar no toggle mostra "objetivo ou teste em execução; troca de provedor só com a frota parada". O teste terminou com 688 ms e 153,4 tok/s (modelo já quente).
- (d) o tile da conta1 no Cockpit mostra "US$ 0,20 · 56,3 s GPU". "N sobrando" não aparece: a última tarefa terminou `done` em 30/30 e é anterior à migração (`early_stop_remaining` nulo).
