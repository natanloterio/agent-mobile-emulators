# Guia — o líder que leva a pessoa do zero à primeira tarefa — design

Data: 2026-09-30 · Protótipo: `design/guia.html`

## Objetivo

Quem usa o Tapflock não é técnico. Hoje o onboarding deixa a máquina pronta e termina em "Criar identidade", que
abre uma tabela com PIN, portas e snapshot. Dali até a primeira tarefa são ~7 ações em 3 telas, na ordem certa, sem
ninguém dizendo qual é a próxima (celular-base → conta Google → provisionar → subir com janela → login → login feito
→ @handle → nova missão). O Guia é um painel que acompanha a pessoa até ela ver a primeira tarefa concluída, e depois
reaparece sempre que algo precisa dela.

**Sucesso** = os quatro marcos do checklist (§2) feitos sem ajuda de fora do app.

Fora de escopo: reescrever as telas existentes (vem no trabalho de copy/IA), e qualquer ação que o daemon ainda não
faz (o Guia só chama rotas que já existem, com uma exceção nova em §6).

## 1. Princípios

1. **Espinha determinística.** O checklist, a detecção de cada passo e a próxima ação são código puro sobre o snapshot
   (`GET /state` + `setup.status()`), sem modelo. Motivo: na primeira execução ainda não há modelo configurado, e
   configurar o modelo é justamente um dos trabalhos do Guia. O modelo (papel líder) só entra para perguntas em texto
   livre (§5), e o Guia funciona inteiro sem ele.
2. **Segredo nunca passa pelo chat.** Conta Google, login do app e PIN são pedidos num cartão de formulário que grava
   direto no cofre (mesma ponte que a tela Identidades usa hoje). O texto digitado não entra no histórico do Guia nem
   em prompt nenhum.
3. **Confirmar o que é irreversível ou custa dinheiro** (§4, coluna "Confirma").
4. **Mostrar o que fez.** Toda ação vira uma linha no registro do painel ("✓ Criei o celular conta1"). Um botão
   "Parar" cancela o que o Guia estiver esperando; ele nunca age sozinho depois disso sem novo clique.
5. **Ensinar a interface.** Quando o próximo passo existe numa tela, o Guia navega até ela e destaca o controle (§3.4)
   em vez de só fazer por trás. A pessoa aprende onde as coisas ficam.

## 2. Checklist de configuração

Quatro marcos, derivados por uma função pura `guideProgress(snap, setup): GuideProgress` (`src/guide/progress.ts`).

| # | Marco | Feito quando | Fazendo quando | Precisa de você quando |
|---|---|---|---|---|
| 1 | Computador pronto | `setup.completed` (ou sem ponte de setup) | — (o onboarding cobre) | — |
| 2 | Celular-base pronto | `baseAvd.found && baseStage(baseAvd) === null` | `baseAvd.prep.state === 'running'` | `prep.state ∈ {needs-google, needs-human}`; `failed` → **Falhou** |
| 3 | Primeira conta conectada | existe identidade com `lifecycle ∈ {logged-in, running, restored}`, `bannedReason === null` e os 5 sinais de `signals` verdadeiros | identidade `provisioned`/`blank` com `booting` ou `online` | identidade `provisioned` online esperando login (`handle` = sem conta) |
| 4 | Primeira tarefa concluída | algum `goal` ou missão com estado `done` | goal/missão `running` | missão `awaiting-human` ou identidade `needs-human` |

Estados de cada marco: `todo · doing · needs-you · done · failed`. Um marco só fica `doing`/`needs-you` quando todos
os anteriores estão `done`. O marco atual é o primeiro que não está `done`.

O checklist aparece no topo do painel e, enquanto não estiver completo, também no topo do Cockpit (cartão
`card--white`, 4 linhas, barra de progresso 4 passos). Completo, some do Cockpit e fica só em Ajuda → "Configuração".

## 3. Superfície

### 3.1 Onde mora

- **Desktop (acima de `--mobile-breakpoint`, 760 px):** painel à direita, **400 px**, que **empurra** o `.main` (não sobrepõe): o grid do Cockpit
  recalcula as colunas. Borda esquerda `var(--border-card)`, fundo `--color-white`; cartões internos com `--radius-control` e `--shadow-card`.
- **Mobile:** bottom sheet a 90 % da altura, alça de 44 px, fecha arrastando ou no ✕.
- **Botão "Ajuda"** fixo: no rodapé da sidebar, acima de Idioma (desktop), e na barra superior (mobile). Mostra um
  ponto lima quando há mensagem nova. Atalho `F1` / `?`.

### 3.2 Quando abre sozinho

1. No fim do onboarding (substitui o "Criar identidade" do passo Pronto: o botão vira "Começar com o Guia").
2. Quando um marco passa para `needs-you` ou `failed`.
3. Quando uma identidade ou missão entra em `needs-human`/`awaiting-human` depois do checklist completo.

Nunca reabre sozinho pelo mesmo evento depois de fechado; o ponto no botão Ajuda fica aceso até a pessoa abrir.
O painel lembra aberto/fechado por sessão.

### 3.3 Anatomia

```
┌ Guia ─────────────────────── [Parar] [✕] ┐
│ Configuração  ●●○○  2 de 4               │  ← checklist recolhível (aberto enquanto incompleto)
├──────────────────────────────────────────┤
│ mensagens (rolagem, mais nova embaixo)   │
│  · texto do Guia                         │
│  · cartão de ação / formulário / confirmação
│  · linha de registro  ✓ Criei o celular  │
├──────────────────────────────────────────┤
│ [ Pergunte ao Guia…            ] [Enviar] │  ← só com modelo líder funcionando (§5)
└──────────────────────────────────────────┘
```

### 3.4 Destaque ("aponte aqui")

`guide.point(target)` navega (`actions.go(screen)`) e aplica ao elemento com `data-guide="<id>"` um anel de 3 px
`--color-green` + sombra `0 0 0 6px rgb(0 0 0 / .12)`, com rolagem até ele. Some no primeiro clique no alvo ou após 8 s.
Com `prefers-reduced-motion`, sem pulsar. Alvos iniciais: `provision`, `base-prepare`, `new-mission`, `take-control`,
`resolve`, `kill`.

### 3.5 Tipos de mensagem (`GuideMessage`)

| Tipo | Uso | Conteúdo |
|---|---|---|
| `say` | explicação curta | texto (máx. ~3 linhas); link opcional "Por quê?" que expande |
| `action` | próximo passo | título, 1 frase, 1 botão primário + até 1 secundário |
| `progress` | algo rodando | rótulo em linguagem simples + barra (quando há `progress`) + fase atual |
| `secret` | conta Google, login, PIN | formulário com `type=password`, grava pela ponte de credenciais; o histórico guarda só "✓ Conta Google guardada" |
| `confirm` | irreversível/pago | o que vai acontecer, custo estimado quando existir, [Confirmar] [Cancelar] |
| `human` | a pessoa precisa agir fora do app | o que fazer, onde (screenshot ou destaque), comando copiável quando é o caso, [Já fiz] |
| `log` | registro | ✓/✕ + frase no passado |

Cada mensagem tem `id`, `at`, `kind`, `milestone` e `status` (`open | done | cancelled`). Cartões `action`,
`secret`, `confirm` e `human` ficam desativados depois de usados.

## 4. Roteiro (espinha determinística)

`src/guide/script.ts`: `nextGuideStep(progress, snap, log): GuideStep | null` — dado o estado, qual mensagem o Guia
deve estar mostrando agora. Idempotente: chamado a cada snapshot; só adiciona mensagem quando a situação muda.

| Situação (derivada) | Mensagem | Ação ao clicar | Rota | Confirma |
|---|---|---|---|---|
| Marco 2 `todo` | `action` "Vamos preparar o celular-base, a cópia de onde saem todas as suas contas. Leva ~10 min." [Preparar] | pede conta Google | — | não |
| Sem conta Google no cofre | `secret` "Conta Google para baixar o Instagram. Ela sai do celular no fim." | salva e prepara | `PUT /base/google`, `POST /base/prepare` | não |
| `prep.state = running` | `progress` com a fase em linguagem simples (tabela §4.1) | — | — | — |
| `prep.state = needs-google` / `needs-human` | `human` com `humanReason` traduzido + "Olhe a janela do celular que abriu" [Já fiz] | continua | `POST /base/continue` | não |
| `prep.state = failed` | `say` motivo traduzido (`daemonErrorText`) + [Tentar de novo] | retoma | `POST /base/prepare` | não |
| Marco 3 `todo` | `action` "Agora o seu primeiro celular. Ele guarda uma conta do Instagram." [Criar celular] + destaque `provision` | cria | `POST /identities` | não |
| Identidade criada, desligada | `progress` "Ligando o celular… 1–2 min" (dispara automático) | — | `POST /identities/:id/boot` `{ window: true }` | não |
| Online, sem conta | `action` "Entre no Instagram na janela que abriu, como no seu celular." [Entrei] · secundário [Prefiro que o Tapflock digite] | pede @handle | — | não |
| "Prefiro que o Tapflock digite" | `secret` usuário + senha do Instagram → login | — | ponte de credenciais + `POST /identities/:id/login` | não |
| [Entrei] | `secret`-leve: campo "Seu @ no Instagram" (não é segredo, mas usa o mesmo cartão) | grava | `POST /identities/:id/login-done` `{ handle }` | não |
| Conectada, sinais incompletos | `progress` "Conferindo se está tudo certo…" com os 5 sinais como ✓/… | — | — | — |
| Marco 4 `todo` | `confirm` "Teste: ler os comentários das últimas 24 h, **sem responder nada**. Custo estimado: {custo}." | lança | `POST /goals/plan` → `POST /goals` | **sim** (custo) |
| Teste rodando | `progress` + botão secundário "Ver ao vivo" (destaque no tile) | — | — | — |
| Teste `done` | `say` "Pronto! {n} comentários lidos em {tempo}. Veja no Relatório." + [Criar minha primeira missão] (destaque `new-mission`) | — | — | — |
| Identidade `needs-human` (a qualquer momento) | `human` com `error` traduzido + [Abrir o celular] (vai ao Device, destaca `take-control`) + [Resolvi] | resolve | `POST /identities/:id/resolve` | não |
| Missão `awaiting-human` | idem, com `humanReason` | continua | `POST /missions/:id/continue` | não |
| Versão do app mudou | `confirm` "O Instagram se atualizou sozinho neste celular. Aceitar a nova versão?" | aceita | `POST /identities/:id/accept-version` | sim |

**O teste do marco 4 usa o caminho de objetivo, não missão.** Objetivos passam pelo gate somente-leitura
(`worker/gate.ts`); dentro de missão o worker pode tocar e digitar qualquer coisa. "Sem responder nada" só é verdade
pelo objetivo. Isso vale mesmo com `GOAL_MODE_VISIBLE = false` na tela Nova missão.

Ações que o Guia **nunca** dispara sozinho, nem com confirmação, sem a pessoa pedir em texto ou clicar na tela
própria: `ban`, `discard`, `restore`, `rebaseline`, `/kill`, trocar papel para nuvem, apagar arquivo.

### 4.1 Fases do celular-base em linguagem simples

| `phase` | Texto |
|---|---|
| `avd` | Criando o celular virtual |
| `boot` | Ligando o celular (1–2 min) |
| `mcp` | Instalando o controle do Tapflock no celular |
| `google` | Entrando na conta Google |
| `app` | Baixando o Instagram na Play Store |
| `finish` | Tirando a conta Google e guardando o celular-base |

## 5. Perguntas em texto livre (modelo líder)

Só aparece quando o papel líder tem teste de conexão `ok` (`providers.leader.lastTest`). Sem isso, a caixa vira a
frase "Para conversar com o Guia, configure a IA em Configurações" com destaque no lugar.

Rota nova no daemon: **`POST /guide/ask`** `{ question, lang }` → `{ answer, proposals[] }`.

- Contexto enviado ao modelo: snapshot reduzido (estados, erros, marcos, custo), **sem** handles de terceiros além
  dos da frota, **sem** credenciais, PINs ou conteúdo de tela.
- Ferramentas do modelo: somente leitura (`state`, `explainError(code)`, `glossary(term)`) e `propose(action)`.
  `propose` **não executa**: vira um cartão `action`/`confirm` que a pessoa clica. O conjunto de ações propostas é o
  mesmo da tabela §4; as proibidas de §4 não podem ser propostas.
- Custo de cada pergunta entra no registro ("Pergunta ao Guia · US$ 0,01").
- Resposta em `lang` da interface; máx. ~120 palavras (instrução no prompt + corte).

## 6. Onde fica o código

| Arquivo | Conteúdo |
|---|---|
| `src/guide/progress.ts` | `guideProgress` (§2), puro |
| `src/guide/script.ts` | `nextGuideStep` (§4), puro |
| `src/guide/useGuide.ts` | liga snapshot → script → mensagens; executa as ações pelas `actions` já existentes em `useFleet` |
| `src/guide/GuidePanel.tsx` + `Guide.css` | painel, bottom sheet, cartões §3.5 |
| `src/guide/point.ts` | destaque §3.4 |
| `src/i18n/messages/guide.ts` | namespace `guide` nos 6 idiomas |
| `daemon/src/server/routes-guide.ts` | `POST /guide/ask` (fase 3), `GET/PUT /guide/log` |
| `daemon/src/db/settings.ts` | chave `guide.log` (últimas 200 mensagens, sem segredo) e `guide.dismissed` |

O registro fica no daemon para sobreviver a reinícios e aparecer igual em qualquer janela.

## 7. Fases

1. **F1 — Checklist e roteiro de configuração** (marcos 1–4, §4 até "Teste done"). Sem modelo. Entrega o objetivo.
2. **F2 — Recuperação**: mensagens de `needs-human`, `awaiting-human`, versão mudou; destaque §3.4 em todas as telas.
3. **F3 — Perguntas livres** (§5).
4. **F4 — @handle automático**: depois de [Entrei], o daemon lê o @ na aba de perfil (`ui-dump`) e só pergunta se
   não achar. Hoje a pessoa digita; é o passo mais fácil de errar.

## 8. Critérios de aceite (F1)

- Máquina limpa, após o onboarding: a pessoa chega ao marco 4 `done` clicando só em botões do Guia e fazendo o login
  do Instagram na janela do emulador.
- Fechar o app no meio de qualquer marco e reabrir: o Guia retoma na mesma mensagem (derivada do snapshot, não da
  memória da UI).
- Nenhum segredo aparece em `guide.log`, no DOM do histórico, nem em log do daemon (teste).
- Cada linha da tabela §4 tem teste de unidade em `script.ts`; §2 tem teste para cada estado de cada marco.
- Teclado: `Tab` percorre o painel; `Esc` fecha; foco volta ao botão Ajuda. Leitor de tela anuncia mensagem nova
  (`aria-live="polite"`; `human`/`failed` com `assertive`).
- Contraste AA em todos os cartões (texto sobre `--color-green` sempre `--color-dark`); alvos ≥ 44 px.

## 9. Medição

Eventos locais em `guide.log` (sem envio para fora): `milestone_done{n, ms}`, `needs_you{milestone}`,
`guide_opened{reason}`, `ask{cost}`. O teste com 5 pessoas não técnicas mede: % que chega ao marco 4 sem ajuda,
tempo até lá, onde para, e nota de facilidade (1–7) por marco.

## 10. Em aberto

- "Celular" ou "Conta" como palavra principal para identidade — decidir no teste com usuários.
- O Guia deve abrir sozinho em (3) de §3.2 ou só acender o ponto? Começar abrindo; medir fechamentos imediatos.
- Custo estimado do teste do marco 4: usar a média dos últimos objetivos ou um valor fixo por modelo?
