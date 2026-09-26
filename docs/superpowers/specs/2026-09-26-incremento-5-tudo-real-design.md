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
