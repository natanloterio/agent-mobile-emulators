# Missões: tarefas longas decompostas pelo próprio agente

**Data:** 2026-09-27 · **Estende:** spec principal (objetivos e worker), inc. 5 (scheduler) e login-determinístico (cofre).

## Objetivo

O usuário escreve uma **missão** em texto livre para uma identidade, por exemplo *"crie uma conta de e-mail, use-a para criar uma conta no Instagram e faça login"*. O agente decompõe a missão em subtarefas **em tempo de execução**, resolve cada uma sozinho (escolhe provedor, app, caminho), avalia o resultado e replaneja até concluir. Quando esbarra em algo que só um humano resolve, a missão **pausa** e espera; depois do "Resolvi, continuar", segue sozinha.

Sucesso: disparar a missão numa identidade "sem conta", sair de perto e voltar para encontrar a conta pronta, ou a missão parada numa subtarefa específica, com o motivo e um botão para continuar.

## Decisões

| decisão | escolha |
|---|---|
| quem define as etapas | o agente, em tempo de execução (planejador → executor → replanejador). Receitas fixas ficam fora desta entrega |
| arquitetura | loop no daemon: planejador (papel `lider`) entre subtarefas; executor = `runTask` em modo missão, contexto limpo por subtarefa |
| limites da missão | nenhum teto automático de custo, tempo ou tentativas. Para em: concluída, humano necessário, pausa manual, kill switch, abandono. Custo e tempo aparecem ao vivo |
| sem progresso | flag informativa `stalled` quando as 3 últimas subtarefas falharam; não para nada |
| permissão no device | **sem gate** dentro de missão. Objetivos comuns seguem somente-leitura |
| humano | captcha, "confirme que é você", conta suspensa, código por telefone → `awaiting-human`. Código enviado ao e-mail do próprio agente: o agente lê e digita |
| segredos | gerados pelo daemon, guardados num cofre do daemon, digitados por referência; nunca chegam ao modelo, ao banco em claro ou a log |

## Modelo de dados

A missão é um `goal` com `pattern = 'mission'`; cada subtarefa é uma `task` desse goal (reaproveita custo, `step` com write-ahead, cockpit e relatório). Migrações (padrão `applyMigrations`):

- `goal.mission_state` (`running` | `awaiting-human` | `paused` | `done` | `abandoned`), `goal.human_reason` text, `goal.stalled` integer default 0, `goal.identity_id` text (identidade da missão).
- `task.seq` integer, `task.objective` text, `task.success_criteria` text, `task.report_json` text. Estados de subtarefa: os de `task` mais `interrupted`.
- Tabela nova:

```sql
create table if not exists mission_memory (
  goal_id text not null references goal(id), key text not null, value text not null,
  secret integer not null default 0, updated_at text not null default (datetime('now')),
  primary key (goal_id, key)
);
```

Com `secret = 1`, `value` é só o id da entrada no cofre.

`goal.state` continua existindo para o relatório: `done` quando `mission_state = done`, `failed` quando `abandoned`; `running` nos demais.

### Ciclo de vida

```
running ──► awaiting-human ──(continue)──► running
   │  └──► paused (kill switch / pausar / infra) ──(resume)──► running
   ├──► done       (planejador: done)
   └──► abandoned  (usuário)
```

- Uma identidade tem no máximo uma missão aberta (`running`, `awaiting-human`, `paused`). Objetivos comuns pulam essa identidade com o motivo `em missão` (via `blockReason` do scheduler).
- Restart do daemon: missões `running` retomam; a subtarefa que estava `running` vira `interrupted` e o planejador é chamado de novo sabendo disso. Nada é repetido às cegas.

## O loop

Um ciclo:

1. O daemon lê a tela da identidade e faz um resumo (app em frente, janela focada, até ~40 rótulos).
2. **Planejador** (papel `lider`, saída estruturada zod, sem `minLength`/`maxLength` pelo mesmo motivo de `LeaderOut`). Entrada: texto da missão; identidade (nome, handle, app alvo); memória (valores comuns por extenso, segredos só pela chave); histórico das subtarefas (seq, objetivo, estado, relatório); resumo da tela; idioma da interface. Saída:

```ts
{ decision: 'next' | 'done' | 'human'; objective: string; success_criteria: string; rationale: string; summary: string; reason: string }
```

   Resposta inválida: uma nova tentativa; falhando de novo, missão `paused` com o erro.
3. **Executor**: `runTask` com `mode: 'mission'`, instrução = objetivo + critério de sucesso + memória. Roda até `finish_subtask`, `request_human`, bloqueio detectado ou esgotar o orçamento da subtarefa (`CONFIG.mission.subtaskStepBudget`, padrão 60; `ENXAME_MISSION_STEP_BUDGET`). Orçamento esgotado = subtarefa `failed` com relatório automático.
4. Grava resultado, recalcula `stalled`, volta ao passo 1.

`done` → `mission_state = done`, promoção de credenciais (abaixo), identidade volta a `idle` (ou `logged-in`).

### Executor em modo missão

- Prompt próprio (`MISSION_SYSTEM_PROMPT`): qualquer app, navegador ou Play Store; ler a tela antes e depois de agir; guardar fatos úteis na memória; nunca digitar senha em texto, sempre `type_secret`; parar e pedir humano em captcha, "confirme que é você" ou código por telefone; não tentar contornar verificação (nem por sites de terceiros); convenção `account.<pacote>.*`.
- Sem `toolApproval` (gate desligado). Continuam: write-ahead, leitura paginada, pacing, piso de qualidade e escalonamento para o modelo de nuvem.
- Ferramentas novas:

| tool | efeito |
|---|---|
| `memory_put(key, value)` | grava fato comum na memória da missão |
| `secret_new(key)` | daemon gera senha forte (20 chars, letras+dígitos+símbolo), guarda no cofre, grava `mission_memory(secret=1)`; devolve `{ key }` |
| `type_secret(node_id, key)` | daemon digita o segredo no nó via `type_append_text` do MCP; devolve `{ typed: true, length }`. O argumento gravado no `step` é só `{ node_id, key }` |
| `request_human(reason)` | subtarefa `needs-human`, missão `awaiting-human` com `human_reason` |
| `finish_subtask({ ok, did, blockers })` | grava `report_json`, subtarefa `done` ou `failed`, encerra o segmento |

- O resultado de `get_screen_state` pode conter o segredo se o campo não for de senha: o wrapper substitui todo valor de segredo da missão por `•••` antes de devolver ao modelo e antes de gravar `result_excerpt`.

### Detecção de humano em modo missão

- `detectHumanCheck(screen)` vale para **qualquer pacote**: captcha (`captcha`, `recaptcha`, `hcaptcha`, `não sou um robô`, `i'm not a robot`), "confirme que é você" / "confirm it's you", conta suspensa, verificação de conta do Instagram. Detectado → subtarefa `needs-human`, missão `awaiting-human`.
- "Insira o código" / "enter the code we sent" **não** dispara em missão. Código por telefone o executor reporta via `request_human`.
- `detectLoggedOut` não para missão (fazer login pode ser a própria subtarefa).
- Objetivos comuns mantêm `detectPlatformBlock` e `detectLoggedOut` como hoje.

### Continuar depois do humano

O usuário resolve pelo "Assumir controle", devolve ao agente e toca **Resolvi, continuar** (`/continue`): missão volta a `running`, o planejador é chamado e vê a tela nova. `continue` com a identidade ainda sob controle humano → 409.

## Cofre do daemon

- Arquivo `~/.local/share/enxame/vault.json` (0600): `{ version: 1, entries: { [entryId]: { iv, tag, data } } }`, AES-256-GCM.
- Chave de 32 bytes guardada no chaveiro do SO via `secret-tool` (libsecret; atributos `service=enxame key=vault`); criada no primeiro uso. Sem `secret-tool` ou sem chaveiro destravado → o cofre recusa, `secret_new` falha e a missão vai para `paused` com o motivo.
- Credenciais de identidade: o Electron passa a ler e gravar credenciais pelo daemon (`GET /identities/credentials` só com usernames; `PUT`/`DELETE /identities/:id/credentials`), migrando o `credentials.json` existente na primeira execução (decifra com `safeStorage`, grava no cofre do daemon, apaga o arquivo antigo). `POST /identities/:id/login` passa a aceitar corpo vazio e usar a credencial do cofre.
- A senha nunca aparece em resposta de API, snapshot, `step`, log ou mensagem ao modelo.

## Promoção ao concluir

Convenção genérica: se a memória tem `account.<pacote>.username` e o segredo `account.<pacote>.password`, ao `done`:

- vira a credencial da identidade no cofre;
- se `<pacote>` é o `app_package` da identidade e o handle é "sem conta", o handle vira `@username`, a identidade vai a `logged-in` e o snapshot é salvo (como no "Login feito").

## API

- `POST /missions { identityId, text }` → `201 { goalId }`. 400 corpo inválido; 409 identidade com missão aberta, `banned`, descartada, sob controle humano, pausada ou `running` num objetivo.
- `POST /missions/:id/pause` · `/resume` · `/continue` · `/abandon` → `200 { missionState }`; 409 em transição inválida.
- Snapshot: `missions: MissionView[]` (abertas + últimas 20 fechadas):

```ts
interface MissionView {
  id: string; identityId: string; text: string; state: 'running' | 'awaiting-human' | 'paused' | 'done' | 'abandoned';
  humanReason: string | null; stalled: boolean; costUsd: number; startedAt: string; finishedAt: string | null;
  current: { seq: number; objective: string } | null;
  subtasks: { seq: number; objective: string; state: string; report: { ok: boolean; did: string; blockers: string } | null; costUsd: number }[];
  memory: { key: string; value: string | null; secret: boolean }[]; // value null quando secret
}
```

- Todas as rotas `/missions*` entram na lista de permissão do `enxame:api`.
- Kill switch: missões `running` → `paused`.

## Interface

- **Novo objetivo**: seletor **Objetivo | Missão**. Missão: texto + uma identidade; prontidão só com os sinais de device (boot, acessibilidade, MCP, tools), sem versão do app. Botão **Iniciar missão**.
- **Cockpit**: tile mostra `Missão · subtarefa N: <objetivo>`; em `awaiting-human`, selo de destaque com o motivo; `stalled` com aviso discreto.
- **Device**: painel **Missão** com linha do tempo (objetivo, ✓/✗/⏸, relatório expansível), memória (segredos como `•••`), custo e tempo, botões Pausar/Retomar, **Resolvi, continuar**, Abandonar.
- **Relatório**: missões na lista de objetivos passados, com custo.
- i18n: textos novos nos 6 idiomas; o planejador escreve no idioma da interface.
- Modo demo: uma missão de exemplo em `awaiting-human`.

## Erros

| falha | efeito |
|---|---|
| orçamento da subtarefa esgotado / `finish_subtask(ok=false)` | subtarefa `failed`; planejador replaneja |
| infra do device (MCP, emulador offline, auth do MCP) | subtarefa `interrupted`, missão `paused` com motivo |
| infra do modelo local | subtarefa `interrupted`, missão `paused` |
| chave da nuvem ausente/inválida | missão `paused`: configure o provedor |
| planejador inválido 2× | missão `paused` com o erro |
| desafio humano / `request_human` / planejador `human` | `awaiting-human` |
| cofre indisponível | missão `paused` |
| kill switch | `paused` |
| restart | `running` retoma; demais ficam |

## Testes

- Loop (planejador e executor falsos): `next → next → done`; replanejamento após falha; `human` → `awaiting-human` → `continue` → `running`; `stalled` após 3 falhas e limpo após sucesso; restart com subtarefa `interrupted`; kill switch → `paused`; infra → `paused`.
- Ferramentas: `type_secret` digita o valor e o segredo não aparece em nenhuma linha de `step`, `mission_memory`, mensagens capturadas do modelo, retorno das tools, logs; mascaramento em `get_screen_state`; `memory_put`; `finish_subtask`; `request_human`.
- Detecção: captcha em pacote qualquer → humano; "insira o código" → não; tela de login → não.
- Promoção `account.<pacote>.*`.
- Cofre: cifra/decifra, arquivo 0600, recusa sem chaveiro, migração do `credentials.json`.
- Rotas: 201/400/409, transições, uma missão aberta por identidade; scheduler pula identidade em missão.
- UI: reducer/seletores de `missions`; telas em desktop e 390 px.
- Verificação real (relatório em `docs/superpowers/reports/`): missão do exemplo numa identidade "sem conta". Mede-se se pausa no lugar certo e se retoma após "Resolvi, continuar"; é esperado que provedores ou o Instagram peçam telefone em algum ponto.

## Fora do escopo

- Receitas fixas e o líder escolhendo receita a partir do texto (passo C, posterior).
- Missões em várias identidades ao mesmo tempo a partir de um só texto.
- Resolver captcha ou verificação por telefone de qualquer forma.
- Tetos automáticos de custo/tempo.
