# Incremento 5 — Nada mockado no modo vivo

**Data:** 2026-09-26 · **Estende:** `2026-09-26-android-swarm-design.md` (§4.1, §4.2, §4.3, §5, §6) · **Base:** `master` em `55e0229`

## 1. Objetivo

Com o daemon vivo (Electron), nenhuma tela mostra dado inventado nem ação que só muda estado local. O modo demo (Vite no browser, sem `window.enxame`) continua existindo com os dados do design, só para revisão visual.

**Inventário do que era mock no modo vivo:**

| tela | mock | vira |
|---|---|---|
| Novo objetivo | "Decompor" era timer de 1,2 s; padrão, tarefas, sonda e estimativa fixos | `POST /goals/plan`: líder (papel `lider`) escolhe fan-out × sharding e instrução por identidade; sonda de 5 sinais real por identidade |
| Novo objetivo | "Iniciar" rodava uma tarefa só na `conta1` | `POST /goals` com o plano: scheduler distribui para todas as identidades prontas, starts escalonados com jitter |
| Cockpit | tiles 2–8 eram demo; tick somava passos/custo | só identidades reais; nenhum tick |
| Cockpit | "Retomar" do kill switch só local | `POST /resume` |
| Device | "Assumir controle" só mudava rótulo | `POST /identities/:id/control` + input real (toque, arraste, texto, teclas) via `adb shell input` |
| Device | "Pausar" / "Resolvi" só locais | `POST /identities/:id/pause`, `POST /identities/:id/resolve` |
| Device | "itens no ledger" = passos/3,4; "tokens de tools" fixo | contagem real do ledger; tokens reais do último passo |
| Relatório | cards (+3, "87 comentários"), objetivos anteriores fixos | `snapshot.goal` e `GET /goals` |
| Identidades | ciclo, snapshot, disco, portas inventados | colunas reais do banco + `du` do AVD |
| Identidades | Provisionar / Liberar disco / Fazer login / Confirmar restore / Re-baseline locais | rotas `POST /identities…` (§3) |
| Sidebar | RAM / vCPU / VRAM calculados de constantes | `snapshot.host` medido (`os`, `/proc/stat`, `nvidia-smi`) |

## 2. Decisões

| decisão | escolha | descartada |
|---|---|---|
| input no modo controle | `adb shell input tap/swipe/text/keyevent` com coordenadas normalizadas 0–1 → pixels de `wm size` | socket de controle do scrcpy (protocolo binário privado, tamanho de tela precisa casar com o do encoder; o spec principal §4.2 já registra o custo de manutenção) |
| líder | `generateText` com saída estruturada (zod) no modelo do papel `lider`; sem chave/erro → regra determinística (§4.3 do spec principal: trabalho preso à conta → fan-out; lista de itens → sharding) e o erro vai no plano | sempre LLM (sem caminho sem chave) |
| scheduler | fila em memória sobre as tarefas do banco; concorrência = identidades prontas; start escalonado `CONFIG.swarm.staggerMs` + jitter; identidade pausada/controlada/needs-human/banned é pulada | processo por worker |
| pacing | atraso com jitter entre passos (`prepareStep`) e teto de ações/hora por identidade | nenhum |
| provisionamento | clonar o AVD-base (`CONFIG.avd.base`) em `CONFIG.avd.home`: cópia do diretório + `.ini` reescrito, `config.ini` com `AvdId`/`avd.ini.displayname` novos; portas por lease; token novo | criar AVD do zero com `avdmanager` (sem o app MCP instalado) |
| boot | `emulator -avd <nome> -port <console> -no-audio -no-boot-anim [-no-window]`; janela visível só para login humano | reaproveitar emulador já aberto |
| disco | `du -sb` do diretório do AVD, cacheado 60 s | `qemu-img info` |
| snapshot | `adb emu avd snapshot save enxame` após login e após tarefa `done`; restaurar via `adb emu avd snapshot load enxame` | `-snapshot` na linha de comando |

## 3. Contrato (compartilhado entre as frentes)

### 3.1 Snapshot (`FleetSnapshot`, WS `snapshot`)

`identities[]` ganha: `lifecycle` (estado cru do banco), `paused`, `controlled`, `ledgerCount`, `lastStepTokens`, `appVersionName`, `consolePort`, `mcpHostPort`, `avdName`, `snapshotTakenAt`, `restoreUnsafe`, `diskBytes`, `bannedReason`, `discardedAt`, `signals` (última sonda ou `null`).

Novos no topo: `goal` (objetivo corrente ou último: `id, text, pattern, state, costUsd, createdAt, finishedAt, tasksTotal, tasksDone, tasksFailed, tasksNeeds, tasksRunning, itemsHandled`) ou `null`; `host` (`ramUsedGiB, ramTotalGiB, cpuPct, threads, vramUsedMiB, vramTotalMiB, at`) ou `null`.

### 3.2 Rotas novas (Bearer do daemon)

| rota | corpo | resposta |
|---|---|---|
| `POST /goals/plan` | `{ text }` | `GoalPlan` (§3.3) |
| `POST /goals` | `{ text, plan? }` | `202 { goalId }`; `409` com objetivo em execução |
| `GET /goals` | — | `{ goals: GoalRow[] }` (mais novo primeiro, 20) |
| `POST /identities` | `{ name?, handle? }` | `201 IdentitySnapshot` — clona o AVD-base |
| `POST /identities/:id/boot` | `{ window?: boolean }` | `202` — sobe o emulador se não estiver no adb |
| `POST /identities/:id/login-done` | `{ handle }` | `200` — `logged-in`, snapshot salvo |
| `POST /identities/:id/pause` | `{ paused }` | `200` |
| `POST /identities/:id/resolve` | — | `200` — `needs-human` → `idle`, erro limpo |
| `POST /identities/:id/ban` | `{ reason }` | `200` |
| `POST /identities/:id/discard` | — | `200` — só `banned`: apaga o AVD, grava `discarded_at` |
| `POST /identities/:id/restore` | `{ confirm? }` | `200`; `409` se `restoreUnsafe` e sem `confirm` |
| `POST /identities/:id/rebaseline` | — | `200` — `pm trim-caches`, re-snapshot |
| `POST /identities/:id/control` | `{ on }` | `200` — controle humano; o worker dessa identidade para |
| `POST /identities/:id/input` | `InputGesture` | `204`; `409` sem controle |

### 3.3 Tipos

```ts
type Pattern = 'fan-out' | 'sharding'
interface ProbeSignals { bootCompleted; accessibility; mcpInitialize; toolsPresent; versionMatch: boolean }
interface PlanTask { identityId; name; handle; instruction: string; signals: ProbeSignals | null; ready: boolean; readyLabel: string }
interface GoalPlan { text; pattern: Pattern; rationale: string; tasks: PlanTask[]; estimate: { tasks: number; outOfProbe: number; stepBudget: number; fleetReadyMs: number }; leader: { model: string; costUsd: number; error: string | null } }
interface GoalRow { id; text; pattern; state; costUsd; createdAt; finishedAt; tasksTotal; tasksDone; tasksFailed; tasksNeeds; tasksRunning; itemsHandled }
type InputGesture =
  | { kind: 'tap'; x: number; y: number }
  | { kind: 'swipe'; x: number; y: number; x2: number; y2: number; durationMs: number }
  | { kind: 'text'; text: string }
  | { kind: 'key'; key: 'back' | 'home' | 'recents' | 'enter' | 'del' }
```

Coordenadas normalizadas 0–1 sobre a tela do device.

### 3.4 Ponte Electron

Um canal genérico `enxame:api(method, path, body)` com lista de permissão de rotas (`electron/api-route.ts`); o preload expõe `window.enxame.api`. `resume` passa a existir.

## 4. Frentes paralelas

A — líder, scheduler, pacing, `/goals*`. B — ciclo de vida da identidade, provisionamento, boot, disco, host, `/identities*` (exceto controle). C — controle humano e input. D — telas ligadas ao contrato.

## 5. Fora de escopo

Keychain do SO para token (continua no banco, como antes); `platform-tools` empacotado; fine-tune/System 1 (fase 6); ações irreversíveis no app alvo (o gate segue somente-leitura).

## Resultado (2026-09-26)

**Suíte:** 443 testes verdes (6 de integração pulados sem `ENXAME_INTEGRATION`); `tsc` do renderer, daemon e Electron limpos; `vite build` ok.

**Verificação real** com um segundo daemon isolado (`ENXAME_DATA_DIR`, `ENXAME_PORT=47811`, `ENXAME_SCRCPY_PORT=27283`, cópia do banco) e um segundo Electron dirigido por Playwright (`.verify/inc5-*.cjs`, capturas em `.verify/inc5/`), sem tocar no app que já estava aberto:

- Todas as telas carregam só dados do daemon: tile único da conta1 com vídeo ao vivo, medidores do host (RAM, CPU com 32 threads, VRAM do `nvidia-smi`), disco real do AVD (5,7 GB), objetivos anteriores do banco.
- Líder local (`gpt-oss:20b`) devolveu plano em português com instrução por conta e sonda de 5 sinais verde.
- Objetivo real pela tela: plano → "Iniciar e sair de perto" → worker na conta1 (14 passos, somente-leitura) → tarefa `done` → objetivo `done` no relatório, em 67 s.
- Controle humano: arraste no canvas abriu a gaveta de apps no emulador; botão Início voltou à home; pausar, retomar e devolver refletiram no daemon.
- Ciclo de vida num clone real (base temporária `mcp_test_emulator` via `ENXAME_AVD_BASE`): provisionar (1,3 s, `.ini` e `config.ini` reescritos, sem `snapshots/`), boot sem janela, login-done com snapshot, re-baseline, restore, ban, descarte (AVD apagado). O SIGINT do daemon derrubou só o emulador que ele subiu.

**Defeitos achados na verificação e corrigidos:**
1. Líder local sempre caía na regra determinística: o SDK não mandava o schema sem `supportsStructuredOutputs`, e o Ollama 0.30 descarta a gramática inteira se o schema tiver `minLength`/`maxLength`. Mesmo corrigido, o modelo escapa ~1 em 3; há uma nova tentativa.
2. Objetivos antigos presos em `running`: reconciliação na subida fecha objetivos, falha tarefas em voo e marca passos sem conclusão para verificação.
3. Seed da conta1 herdava o AVD da base configurável.
4. Restore sondava com o device ainda offline e marcava needs-human por engano.

**Pendências conhecidas:**
- Provisionar com a base padrão exige parar o emulador da conta1: o AVD-base desta máquina é o próprio AVD dela. O clone tem a conta limpa no primeiro boot (`pm clear`), mas o ideal é um AVD dourado separado (`ENXAME_AVD_BASE`).
- Texto com acento não é digitável no modo controle (`input text` só aceita ASCII).
- (resolvido) custo na nuvem agora é por modelo: Haiku 4.5, Sonnet 5 e Opus 5; modelo desconhecido conta como Opus 5.

## Correção pós-merge (2026-09-26, noite)

- **"No handler registered for 'enxame:api'"**: o processo principal do Electron aberto antes do merge não tinha o canal, e os canais só eram registrados depois de o daemon responder. Agora todos os canais existem desde a subida e respondem "daemon não conectado" enquanto ele não sobe.
- **Base dourada**: `CONFIG.avd.base` usa `enxame_golden` quando esse AVD existe (senão o da conta1, que precisa estar parado).
- **AVD com PIN**: o `mcp_test_playstore` tem bloqueio de tela com PIN (`CredentialType: PIN`), o que a spec principal §4.1 proíbe. Um clone dele nasce travado em `FallbackHome` e a conta1 fica em `RUNNING_LOCKED` depois de qualquer reboot. O boot agora detecta `RUNNING_LOCKED` e marca a identidade offline com a explicação. **Ação humana necessária:** digitar o PIN na janela do emulador da conta1, remover o bloqueio de tela (Configurações → Segurança → Bloqueio de tela → Nenhum) e só então criar `enxame_golden` com a conta1 parada.

## PIN por identidade (2026-09-26, decisão do usuário)

Substitui a regra "sem bloqueio de tela por credencial" do spec principal §4.1: cada identidade pode ter PIN, e o daemon se vira com ele.

- **Registro:** `identity.lock_pin` (só dígitos, 4–16). O snapshot expõe só `hasPin`; o valor nunca sai do daemon. Mesmo nível de guarda do `mcp_token` (banco local); keychain continua pendente para os dois.
- **Provisionar:** `POST /identities {pin?}` (ou `ENXAME_DEFAULT_PIN`); o primeiro boot destrava, limpa a conta do app alvo e aplica o PIN (`locksettings set-pin`), porque a base dourada não tem credencial.
- **Destravar:** antes de toda sonda (plano, scheduler, teste de provedor, restore) e depois do boot: acordar, `wm dismiss-keyguard`, digitar o PIN, Enter; confirma por `dumpsys user` (`RUNNING_UNLOCKED`) e `isKeyguardShowing=false`. Uma tentativa por chamada; PIN recusado vira `needs-human` e ninguém tenta de novo sozinho (tentativas erradas bloqueiam o device por tempo).
- **Identidade existente:** `POST /identities/:id/pin {pin}`; com o device no adb, só grava se o PIN destravar de fato. Na tela, "Registrar PIN" aparece nas linhas sem PIN.
- **Token herdado da base:** clone nasce com o token MCP da conta1. 401 na sonda agora reenvia a configuração e reinicia o servidor MCP; logo após destravar, o daemon espera 4 s antes de configurar (o app ainda está subindo e perdia o broadcast).
- **Verificado:** clone real com PIN 2468 → reboot a frio (`RUNNING_LOCKED`) → plano do líder destravou, trocou o token e marcou "pronto". Base `enxame_golden` criada da conta1 com ela parada; a conta1 voltou com PIN 1234.
