# Incremento 2 — Provedor local (Ollama) para o worker

**Data:** 2026-09-26 · **Estende:** `2026-09-26-android-swarm-design.md` (§4.4 Camada de provedor, fase 5 do §9) · **Base de código:** `master` em `b7f15bf` (incremento 1 mergeado)

## 1. Objetivo

Rodar o papel *worker* em um modelo local servido pelo Ollama, com a tela Provedores ligada ao daemon, teste de conexão real e piso de qualidade com escalonamento para a nuvem — e medir, com a mesma tarefa do incremento 1, se o local substitui o Haiku 4.5 no worker.

**Baseline a bater (incremento 1, Haiku 4.5, 2026-09-26):** 30 passos, 57 s, US$ 0,2102, 353k tokens de entrada (176k lidos do cache), 100% das tool calls válidas, 1 negação do gate, sem bloqueio de plataforma.

**Entregável observável:** relatório comparativo Haiku × modelo local vencedor do bake-off, produzido por um comando reprodutível, e a tela Provedores operando o registro real.

## 2. Decisões tomadas no brainstorm

| decisão | escolha | alternativa descartada |
|---|---|---|
| escopo | worker local + tela real + piso de qualidade (fase 5 inteira) | só env + medição |
| modelo | bake-off entre os já presentes no disco | fixar `qwen3.5:27b`; baixar outro |
| processo do Ollama | daemon sobe sob demanda como processo filho | serviço systemd; manual |
| provedor no SDK | `@ai-sdk/openai-compatible` (Ollama `/v1`) | provedor nativo `ollama-ai-provider-v2` (só se o bake-off exigir `think` por chamada) |
| escalonamento | continua a mesma conversa no modelo de escalonamento | reiniciar a tarefa na nuvem |

## 3. Restrições e fatos medidos

- Máquina: RTX 5090 (32 607 MiB), ~3,5 GiB ocupados pelo emulador com `-gpu host`; 125 GB RAM; 400 GB livres em disco.
- Ollama 0.30.7 em `/usr/local/bin/ollama`, sem serviço systemd. Padrões observados ao subir: `OLLAMA_CONTEXT_LENGTH=0` (usa o padrão do modelo, historicamente 4096, **truncando o prompt em silêncio**), `OLLAMA_KEEP_ALIVE=5m`, `OLLAMA_NUM_PARALLEL=1`.
- Modelos no disco (`~/.ollama`, 49 GB): `qwen3.5:27b`, `gpt-oss:20b`, `gemma4:12b`, `qwen2.5-coder:14b`, `llama3.2`, `qwen2.5:0.5b`, `gemma:2b`, `qwen-claude`, `kimi-k2.5:cloud` (este não é local; fora do bake-off).
- Passos do worker chegam a ~19k tokens de entrada com 11 tools; o contexto do Ollama tem de ser ≥ 32k.
- `ai@7.0.116`: tool call com argumentos inválidos chega como parte `tool-call` com `invalid: true` mais `tool-error` (`InvalidToolInputError`/`NoSuchToolError`); `onLanguageModelCallStart/End` existem para medir tempo de geração. `@ai-sdk/openai-compatible@3.0.57`: `createOpenAICompatible({ name, baseURL, includeUsage })`, peer `zod ^3.25 || ^4.1` (compatível com o instalado).
- Prompt cache do Anthropic (piso de 4096 tokens no Haiku 4.5) não tem equivalente na API `/v1` do Ollama; o Ollama reutiliza KV do prefixo por processo enquanto o modelo está carregado — depende de `KEEP_ALIVE` e de não alternar modelos.

## 4. Arquitetura

### 4.1 Princípio

O worker não sabe qual provedor está por trás: recebe um `LanguageModel` de uma fábrica e um contador de qualidade. Tudo que é específico do Ollama vive em um módulo.

```
daemon/src/provider/
  config.ts   tipos + leitura/escrita de provider_config (por papel), defaults, validação zod
  factory.ts  buildModel(role, cfg, env) → LanguageModel   (anthropic | openai-compatible)
  ollama.ts   supervisor: ensureOllama(cfg, deps) → { running, spawnedByUs } ; stopOllama()
  probe.ts    testProvider(role, deps) → ProviderTest
  quality.ts  QualityFloor(limit): observe(step) / tripped() / count()
daemon/src/server/api.ts   + GET /providers · PUT /providers/:role · POST /providers/:role/test
daemon/src/worker/run.ts   usa factory + quality; dois segmentos (§5)
daemon/src/cli/bench.ts    bake-off + corrida completa + relatório (§8)
src/live/*, src/screens/Providers.tsx   tela ligada ao snapshot/bridge em vez do mock
```

### 4.2 Papéis e defaults

| papel | mode | model | endpoint |
|---|---|---|---|
| `worker` | `nuvem` (fábrica) → `local` após o benchmark | `claude-haiku-4-5` (fábrica) → vencedor do bake-off | Anthropic → `http://127.0.0.1:11434/v1` |
| `esc` | `nuvem` | `claude-haiku-4-5` | Anthropic |
| `lider` | `nuvem` | `claude-sonnet-5` | Anthropic — **inerte** neste incremento; o registro já o prevê para a fase 4 |

O default do `worker` só vira `local` no código depois do benchmark; até o relatório, `nuvem` continua sendo o default de fábrica e `local` é escolhido pela tela ou pelo `bench.ts`. Assim o incremento não degrada o comportamento do incremento 1 antes de provar o novo.

### 4.3 Supervisor do Ollama (`ollama.ts`)

`ensureOllama(cfg.worker)`:

1. `GET {endpointBase}/api/tags` (o `endpointBase` é o endpoint sem o sufixo `/v1`). Responde → `{ running: true, spawnedByUs: false }`. Fim.
2. Não responde → `spawn('ollama', ['serve'])` com env: `OLLAMA_HOST` derivado do endpoint, `OLLAMA_CONTEXT_LENGTH=32768`, `OLLAMA_KEEP_ALIVE=30m`, `OLLAMA_NUM_PARALLEL=1`. Stdout/stderr vão para `~/.local/share/enxame/ollama.log`.
3. Espera `/api/tags` responder, até 20 s. Não respondeu → mata o filho e devolve erro classe `infra-local` ("Ollama não subiu em 20 s; veja ollama.log").
4. Registra o PID em memória e em `daemon.json`; `stopOllama()` envia SIGTERM no encerramento do daemon e no kill switch. Um Ollama que **não** foi subido pelo daemon nunca é morto nem reiniciado — o teste de conexão apenas avisa que o contexto configurado é desconhecido.

Se o modelo pedido não está no disco (`/api/tags` não o lista), o erro é `infra-local` ("modelo X não está no disco; `ollama pull X`") — o daemon **não** faz pull sozinho (download de dezenas de GB sem pedir não é fire-and-forget, é surpresa).

### 4.4 Fábrica (`factory.ts`)

- `mode === 'nuvem'` → `createAnthropic({ apiKey })(model)`. Sem chave → erro classe `auth` antes de qualquer chamada.
- `mode === 'local'` → `createOpenAICompatible({ name: 'ollama', baseURL: endpoint, includeUsage: true })(model)`.
- As `providerOptions` do Anthropic (cache 1h, `disableParallelToolUse`) só entram quando o modelo é Anthropic; para local, `toolChoice` continua `'auto'` e o `prepareStep` de poda é o mesmo.

### 4.5 Piso de qualidade (`quality.ts`)

`QualityFloor(limit = 3)` é um objeto puro. Em `observe(step)` conta, por passo:

- cada parte `tool-call` com `invalid: true`;
- cada `tool-error` cujo erro é `InvalidToolInputError` ou `NoSuchToolError`.

O outro modo de falha típico de modelo local — responder em prosa em vez de chamar tool — **não é gatilho do piso**: dentro do `generateText` um passo só de texto encerra o loop, então ele aparece como tarefa terminada cedo. É medido no relatório como "encerrou sem tool call com N passos de orçamento sobrando" (§8), não penalizado em tempo de execução.

Não conta: negação do gate (é o modelo sendo barrado por política, comportamento correto), `tool-error` de infraestrutura (classe `infra`/`auth`), alucinação de `node_id` inexistente (o servidor MCP responde erro de negócio; isso é medido, não penalizado — o Haiku também erra `node_id`).

Contagem é **por tarefa, acumulada**, não consecutiva. `tripped()` é `true` a partir de `limit`.

### 4.6 Tela Provedores

A tela existente (toggle Nuvem/Local, modelo, endpoint, botão de teste por papel) passa a operar sobre o snapshot vivo:

- `GET /providers` entra no snapshot (`providers: Record<RoleKey, ProviderRow>`), `merge.ts` o transforma em `RoleVM`.
- Toggle e edição de modelo/endpoint chamam `PUT /providers/:role` pelo bridge (`window.enxame.setProvider(role, patch)`).
- Botão "Testar conexão" chama `POST /providers/:role/test` e mostra `latência · tok/s · args válidos`, ou a mensagem da classe de erro ("Ollama parado — subindo…", "modelo não está no disco", "identidade não pronta").
- O último `provider_test` por papel aparece na tela ao abrir (vem do snapshot).

## 5. Fluxo do worker

```
runTask(o)
 ├─ cfg = readProviderConfig(db)                                    # worker + esc
 ├─ se cfg.worker.mode == 'local': ensureOllama(cfg.worker)          # falha → 'infra-local'
 ├─ floor = QualityFloor(3)
 ├─ segmento 1: generateText({ model: buildModel('worker'), messages,
 │                stopWhen: [stepCountIs(budget), halted, () => floor.tripped()],
 │                onStepFinish: floor.observe + recordStep(provider, gen_ms) })
 ├─ se floor.tripped():
 │    se cfg.esc.mode == 'nuvem' e há chave:
 │       task.degraded = 1 ; task.escalated_at_step = passos usados
 │       segmento 2: generateText({ model: buildModel('esc'),
 │                    messages: seg1.response.messages,
 │                    stopWhen: [stepCountIs(budget − usados), halted] })
 │    senão: outcome = 'quality-floor' → task 'failed', identidade 'idle'
 └─ finish(outcome, resumo do último segmento)
```

- `seg1.response.messages` é `ModelMessage[]` neutro a provedor, com os `tool-result` dos passos válidos. **Medido no `ai@7.0.116`:** passos cujas tool calls foram inválidas são descartados de `response.messages` (o SDK não gera `tool` message para eles), então o modelo de escalonamento não os vê. O segmento 2 recebe `[...mensagens iniciais, ...seg1.response.messages, { role: 'user', content: nota de escalada }]`, onde a nota diz que o modelo anterior falhou N vezes ao chamar tools e que a tarefa continua de onde a tela parou. A poda de telas roda de novo no `prepareStep` do segmento 2.
- Orçamento é único para a tarefa. O prompt cache do Anthropic começa frio no segmento 2 — custo esperado de uma tarefa degradada, vai para o relatório.
- **Sem repetição automática** após `quality-floor` (mesma regra do bloqueio de plataforma). A identidade volta a `idle`, nunca `needs-human`: a conta está bem, o modelo é que não serviu.
- `outcome` ganha o valor `'quality-floor'`; `escalated` (já existe em `step`) marca as linhas do segmento 2.

**Registro por passo.** `recordStep` recebe `provider` (`local:qwen3.5:27b` / `nuvem:claude-haiku-4-5`) e `gen_ms` (medido entre `onLanguageModelCallStart` e `onLanguageModelCallEnd`), e marca `invalid_call = 1` nas linhas contadas pelo piso. Custo: nuvem pela tabela de preço como hoje; local `cost_usd = 0` e a conta é `gen_ms`. O snapshot mostra as duas unidades ("12,4k tok · 3,1 s GPU").

## 6. Teste de conexão (`probe.ts`)

`testProvider(role)` é o caminho do worker encolhido: `ensureOllama` (se local) → `buildModel(role)` → `generateText` com **apenas** `android_<slug>_get_screen_state`, `toolChoice: 'required'`, `stepCountIs(1)`, contra `conta1` pronta (`ensureIdentityReady` antes; identidade não pronta → 409).

Devolve `ProviderTest { role, model, latencyMs, tokensPerSec, argsValid, error? }`:
- `latencyMs`: chamada inteira;
- `tokensPerSec`: `outputTokens / gen_ms`;
- `argsValid`: a tool call veio sem `invalid` e executou;
- `error`: texto já classificado (`infra-local`, `auth`, `infra`).

É somente-leitura, não passa por gate (não há ação), não grava `step`; grava `provider_test`. Não conta para o orçamento de nenhuma tarefa e é recusado enquanto houver goal em execução (single-flight já existente).

## 7. Tratamento de erro (delta do §6 do spec principal)

| classe | exemplos | efeito |
|---|---|---|
| `infra-local` (nova) | Ollama não sobe em 20 s; modelo não está no disco; OOM de VRAM (`500` do Ollama com "out of memory"); conexão recusada no endpoint local | tarefa volta a `todo`, identidade `idle`, causa no snapshot e na tela; **não** escala para a nuvem sozinho (gasto inesperado sem pedido) |
| `quality-floor` (nova) | 3 chamadas inválidas / prosa sem tool acumuladas | escala se `esc` for nuvem com chave; senão `failed` |
| `auth`, `infra`, `platform-block`, `budget` | inalteradas | inalteradas |

Erros do Ollama chegam pelo `@ai-sdk/openai-compatible` como `APICallError` com status; a classificação lê status e corpo (`model not found` → 404; OOM → 500 + texto). Sem status (ECONNREFUSED) → `infra-local` quando o provedor é local, `infra` quando é nuvem.

## 8. Benchmark e critério de sucesso

Tudo em `daemon/src/cli/bench.ts`, um comando (`npm run bench`), pré-condições iguais às do `real:run` (emulador desbloqueado, `conta1` pronta, `.env`).

1. **Bake-off:** para cada modelo de `qwen3.5:27b`, `gpt-oss:20b`, `gemma4:12b`, `qwen2.5-coder:14b`: `PUT worker.model` → 3× `testProvider('worker')` → mediana de `latencyMs` e `tokensPerSec`. `argsValid` em 3/3 é pré-requisito; falhou uma, eliminado. Desempate por tok/s. Ao trocar de modelo, o supervisor espera o descarregamento (o `KEEP_ALIVE` de 30 m manteria dois modelos na VRAM; `bench.ts` envia `keep_alive: 0` ao modelo anterior via `/api/generate` antes de carregar o próximo).
2. **Corrida completa** com o vencedor: mesma tarefa do incremento 1, `stepBudget = 30`, mesma identidade e versão do app; `esc` = Haiku ativo.
3. **Controle:** uma corrida Haiku no mesmo dia (US$ ~0,21) para eliminar variação da tela do Instagram.
4. **VRAM:** `nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits` amostrado a cada 2 s durante a corrida local; pico vai para o relatório — é o número que o §4.4 do spec principal declara não ter medido.
5. **Relatório** `docs/superpowers/reports/<data>-incremento-2.md`: tabela do bake-off; e local × Haiku: passos, tempo total, s·GPU (`gen_ms` acumulado), tokens in/out, tool calls inválidas, degradou? em que passo, encerrou sem tool call com orçamento sobrando? (passos restantes), custo US$ (nuvem) e s·GPU (local), pico de VRAM, resumo do agente de cada um, bloqueio de plataforma (esperado: nenhum).

**Critério de sucesso do incremento:** o vencedor completa a tarefa **sem disparar o piso** e com tempo total ≤ 3× o do Haiku do mesmo dia. Nesse caso o default de fábrica do `worker` muda para `local` com esse modelo. Se disparar o piso mas o escalonamento concluir, o mecanismo está entregue e o default permanece `nuvem` — decisão sua com os números.

## 9. Modelo de dados (delta do §8 do spec principal)

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
  args_valid integer not null, error text
);
alter table step add column provider text;          -- 'local:qwen3.5:27b' | 'nuvem:claude-haiku-4-5'
alter table step add column gen_ms integer;         -- tempo de geração; s·GPU quando local
alter table step add column invalid_call integer not null default 0;
alter table task add column degraded integer not null default 0;
alter table task add column escalated_at_step integer;
```

Migração: `openDb` aplica os `alter table` de forma idempotente (verifica `pragma table_info` antes). O banco do incremento 1 continua válido.

## 10. Testes

Unitários (vitest; shape real do SDK + `MockLanguageModelV4`, padrão do incremento 1):

| módulo | prova |
|---|---|
| `provider/config` | defaults por papel na primeira leitura; `PUT` valida com zod; leitura devolve cópia imutável |
| `provider/factory` | `local` → openai-compatible com `baseURL` do registro e `includeUsage`; `nuvem` → anthropic; `nuvem` sem chave → `auth` antes de chamar |
| `provider/ollama` | `exec`/`fetch` injetados: vivo → não spawna; morto → spawna com env exato e espera `/api/tags`; 20 s → `infra-local`; externo → `spawnedByUs=false`, nunca morto; modelo ausente em `/api/tags` → `infra-local` |
| `provider/quality` | conta `tool-call{invalid}` e `tool-error` de input; não conta gate, infra nem passo só de texto; dispara em 3 acumulados, não consecutivos |
| `worker/run` | piso → 2º `generateText` com modelo de `esc`, `response.messages` do 1º e `budget − usados`; `degraded`/`escalated_at_step`; sem `esc` nuvem → `quality-floor`/`failed`/`idle`; `provider`/`gen_ms`/`invalid_call` gravados; Ollama que não sobe → `infra-local` sem chamar modelo |
| `provider/probe` | só `get_screen_state` com `toolChoice:'required'`; grava `provider_test`; classifica 404 e ECONNREFUSED |
| `server/api` | `GET/PUT /providers`, `POST /providers/:role/test`; `PUT` inválido → 400; identidade não pronta → 409; goal em execução → 409 |
| `src/live` | `merge.ts` mapeia `providers` do snapshot para `RoleVM`; toggle e teste chamam o bridge |

Integração (`ENXAME_INTEGRATION=1`): `ensureOllama` real + `testProvider('worker')` real contra `conta1`.

## 11. Fora de escopo deste incremento

Líder e decomposição; vários workers no mesmo Ollama (`NUM_PARALLEL > 1`, disputa de KV cache do §4.4 — fase 4); fine-tune/System 1; vLLM, LM Studio e llama.cpp (endpoint configurável, não testados); controle de `think` por requisição (abordagem B, só se o bake-off pedir); `ollama pull` automático; alterar a tarefa de benchmark ou a política somente-leitura do gate.

## 12. Riscos

- **Tool calling de modelos locais pela API `/v1` do Ollama** varia por modelo (template de chat). O bake-off existe para isso; se nenhum dos quatro passar `argsValid` 3/3, o relatório sai com a tabela e o incremento termina com o default em `nuvem` — resultado válido.
- **Contexto:** se o Ollama já estiver de pé com `OLLAMA_CONTEXT_LENGTH` menor que 32k, os passos longos são truncados em silêncio. Mitigação: o teste de conexão avisa quando não foi o daemon que subiu o processo; o benchmark exige `spawnedByUs=true`.
- **VRAM com emulador + modelo 27B (~17 GiB Q4) + KV de 32k:** cabe com folga para um worker; a medição do pico é um entregável, não uma suposição.
- **Thinking do qwen3.5** pode consumir tempo/tokens antes da tool call. Se o bake-off mostrar tok/s bom e latência alta, a saída é a abordagem B ou um Modelfile sem thinking — decisão após medir.
