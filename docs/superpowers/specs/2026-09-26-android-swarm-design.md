# Agent Mobile Emulators — Design

**Data:** 2026-09-26
**Status:** design aprovado seção a seção; aguardando revisão do spec antes do plano de implementação

---

## 1. Objetivo

Um aplicativo desktop que opera um enxame de emuladores Android, cada um vinculado a uma
identidade persistente, dirigido por agentes de IA. O usuário descreve um objetivo em
linguagem natural, o sistema decompõe em tarefas, distribui entre as identidades e executa
sem supervisão passo a passo. O caso de uso é automação de apps que não expõem API.

**Objetivo de exemplo, dado pelo usuário:** responder comentários em N contas do Instagram.

**Modo de operação escolhido:** objetivo e sai de perto. O usuário não acompanha cada passo;
volta para ver resultado, custo e o que precisou de atenção humana.

## 2. Fora de escopo

Decidido explicitamente, não por omissão:

- **Criação de contas em massa em plataformas de terceiros.** O sistema não fabrica identidades.
  Automação de cadastro é suportada apenas em apps do próprio usuário.
- **Camada de evasão de defesas de plataforma:** rotação de fingerprint, farm de SMS,
  resolução de captcha, rotação de IP para criação de contas. Além da questão de fundo, é a
  parte que quebra continuamente e colocaria o produto em manutenção permanente.
- **Escala além de ~10 emuladores simultâneos.** Ver seção 3.
- **Device físico.** O design assume emulador; a escolha de scrcpy na seção 4.2 preserva o
  caminho para hardware real, mas nada além disso.

O que resta em escopo: operar contas próprias ou de clientes que autorizaram, incluindo
provisionamento, execução de tarefas e verificação.

## 3. Restrições medidas

Medidas nesta máquina em 2026-09-26, não estimadas:

| Item | Valor |
|---|---|
| Host | i9-14900K (32 threads), 125 GB RAM, RTX 5090 32 GB VRAM, 397 GB disco livre |
| RSS de um emulador | 4,6 GB |
| Tamanho de um AVD | 3,4 GB (cresce com dados do app) |
| Teto prático | 8–12 emuladores responsivos; ~20 no limite |
| Boot frio até `sys.boot_completed` | ~40 s |
| `tools/list` do servidor MCP | 57 tools, ~7,7k tokens (chars/4) |
| Subset de 11 tools p/ fluxo de comentários | ~1,5k tokens (−80%) |
| `android_get_screen_state` (tela esparsa) | ~2,3k tokens |
| Laya: primeira carga / inferência | 67 s / 20–47 ms |
| Laya zero-shot no nosso domínio | 5/9 acertos, com erros de alta confiança |

**Alvo de escala: ≤ 10 identidades simultâneas, tudo local.**
Consumo projetado: 60–100 GB de disco, ~46 GB de RAM.

### Viabilidade do alvo (validada)

Instagram 448.0.0.52.84 roda no emulador Play Store API 34: abre, mantém sessão autenticada
e carrega feed. Sem bloqueio de Play Integrity no launch.

**O que isso não cobre:** Play Integrity é frequentemente consultado em ações específicas
(cadastro, publicação), não no launch. E detecção de automação no Instagram é comportamental
— cadência, padrão de interação, horário — não atestação de device. Automação do Instagram
viola os ToS da plataforma independentemente de a conta ser própria; o risco concreto é
checkpoint ou banimento da conta, que é justamente o ativo caro de provisionar.

## 4. Arquitetura

### 4.1 Identidade = AVD

Uma identidade é um AVD nomeado mais seu estado de provisionamento. Não é um emulador
genérico que recebe login; é um device que pertence a uma conta e envelhece com ela.

**Imagem-base (golden).** Construída uma vez: Play Store API 34 x86_64, app MCP instalado,
permissões concedidas, servidor configurado (token, `auto_start_on_boot`, `device_slug`),
nenhuma conta de terceiro. Snapshot.

**Materialização.** Clonar o AVD-base, novo nome e serial. Login acontece **uma vez**, em
janela visível, feito por humano — validado na prática: o Instagram foi logado manualmente e
funcionou. Snapshot vira o ponto de restauração daquela identidade.

**Snapshot não é reset por execução.** Numa conta persistente o histórico e o cache do app
devem se acumular; reverter a cada job descarta continuidade e faz a conta parecer um device
recém-formatado toda vez. Snapshot é recuperação de desastre.

**Ciclo de vida:** `blank → provisioned → logged-in → running → dirty → restored`.

**Sonda de prontidão.** Um device entra na frota apenas com os quatro sinais verdes:
`sys.boot_completed=1`, accessibility service ativo, `initialize` HTTP 200, `tools/list`
com a contagem esperada. Roda a cada subida do device.

**Portas determinísticas.** Cada identidade carrega `console_port = 5554 + 2n` e
`mcp_host_port = 8080 + n`. No start o daemon refaz o `adb forward` e confirma com a sonda.
O usuário nunca executa `adb` à mão.

**Credenciais** vão para o keychain do SO, nunca para o banco.

### 4.2 Cockpit (grid + tela ampliada)

Grid com todos os emuladores; clique amplia um. A tela ampliada com input é também a
interface de provisionamento da seção 4.1.

| | Grid (N devices) | Ampliado (1 device) |
|---|---|---|
| Resolução | `--max-size 320` | `--max-size 1080` |
| FPS | 3–5 | 30–60 |
| Bitrate | ~500 Kbps | ~8 Mbps |
| Input | desligado | ligado |

Ao ampliar, o daemon derruba o stream de thumbnail e abre um novo em alta qualidade —
scrcpy não renegocia em runtime. Custo permanece constante: N−1 streams baratos + 1 caro.

**scrcpy, não a API gRPC do emulador.** A gRPC seria mais direta mas só serve emulador;
scrcpy também serve device físico e já traz injeção de input. Requisitos: **scrcpy ≥ 4.x**
(o 1.25 do apt falha ao injetar toque no Android 14 com `NullPointerException` em
`Device.injectEvent`) e binário **empacotado no app**, não dependente da máquina.

**Processos.** Um daemon Node é dono de `emulator`, `adb` e um `scrcpy-server` por device,
e supervisiona: se um stream morre, reinicia e o tile aparece degradado em vez de congelar.
O renderer apenas desenha.

**Stack:** Electron + React no renderer, Node no main, H.264 decodificado com `WebCodecs`
para canvas. Tauri foi considerado e descartado: economizaria RAM irrelevante ao lado de
emuladores de 4,6 GB, ao custo de Rust no processo que gerencia a frota.

**Cada tile mostra** nome da identidade, app alvo, estado (`idle / running / needs-attention
/ offline`), tarefa atual e último erro. Em modo fire-and-forget, o grid é onde o usuário
descobre qual identidade travou.

### 4.3 Orquestração

**Decomposição com regra explícita.** O líder escolhe entre:

- **Fan-out replicado** — quando a unidade de trabalho pertence à conta (cada conta responde
  os comentários da própria caixa). Uma tarefa por identidade.
- **Sharding** — quando há fila compartilhada de itens. N tarefas alocadas por capacidade.

Regra: trabalho preso à identidade, fan-out; lista de itens, sharding. O padrão escolhido
fica registrado na execução.

**Fila em SQLite com escritor único (o daemon).** Divergência deliberada do `agent-team`, que
usa fila em arquivos: lá o worktree git é a unidade de isolamento; aqui o daemon já é dono de
todo o estado e o dashboard precisa de query.

**Worker por device.** Sessão longa, um device apenas, carregando o contexto daquela
identidade. Herdamos do `agent-team` a forma (líder / worker / verificação) e não a
implementação — não há repo, worktree nem PR; o artefato é ação num app.

**Escopo de tools por worker.** Cada worker enxerga só o MCP do seu device. Dar os N devices
a um worker seriam 57×N definições por turno e risco de agir na conta errada. O `device_slug`
do app deixa o nome da tool inequívoco no log (`android_conta3_tap`).

**Economia de tokens, em ordem de impacto:**

1. **Prompt caching** — as ~7,7k de tool definitions são prefixo fixo, candidato ideal a cache.
2. **Poda de histórico** — o lever real. A ~2,3k por screen state, 20 passos acumulam ~46k de
   telas que ninguém relê. Manter os últimos 1–2 estados.
3. **Subset de tools por workload** (−80%) — ajuda na margem e reduz confusão do modelo.

**Escada de escalonamento.** Worker barato tem orçamento de passos. Escala para o modelo forte
quando: tela inesperada N vezes, orçamento estourado, ou ação marcada como sensível.
Escalonamentos têm teto.

**Pacing.** Jitter entre ações, teto de ações/hora por identidade, starts escalonados.

**Contabilidade de custo** por tarefa e por objetivo, gravada e exibida. Em fire-and-forget o
usuário não observa a execução; precisa da conta depois.

### 4.4 Camada de provedor

Tela separada para configurar provedor de LLM, incluindo modelos locais.

**Vercel AI SDK** como camada de abstração: tool calling uniforme entre provedores, cliente
MCP nativo, e local via endpoint OpenAI-compatible (vLLM, Ollama, LM Studio, llama.cpp).
O Claude Agent SDK foi descartado por ser específico de um provedor.

**Configuração por papel, não global:**

| Papel | Volume | Perfil |
|---|---|---|
| Líder (decomposição) | 1× por objetivo | modelo forte |
| Worker por device | 20 passos × N contas | barato e rápido — onde local ganha |
| Escalonamento | raro | modelo forte |

**Concorrência é o gargalo local, não o tamanho do modelo.** N workers no mesmo endpoint é
caso de batching contínuo: vLLM aguenta, Ollama serializa muito mais. A RTX 5090 (32 GB)
comporta modelos classe 30B em 4-bit (~18–20 GB); 70B em 4-bit não cabe sem offload que
inviabiliza o loop.

**"Testar conexão" roda um tool-call canônico** contra um device vivo e reporta latência,
tokens/s e se os argumentos vieram estruturados e válidos. Modelo local que responde bem em
chat e falha em tool calling é o modo de falha comum.

**Piso de qualidade.** Se o modelo local errar a chamada de tool N vezes numa tarefa, o worker
escala para nuvem e marca a tarefa como degradada.

**Custo em duas unidades:** nuvem em tokens e dinheiro; local em tokens e segundos de GPU.

### 4.5 Camada System 1 (Laya) — fase 6

Laya (`convaiinnovations/laya`, Apache 2.0) é um modelo de decisão não-autorregressivo:
ModernBERT-large + cabeça de decisão, 421M params. Recebe um estado e perguntas tipadas,
devolve respostas tipadas com probabilidade calibrada em um forward pass. Tem cabeça de
act/escalate. Não gera texto, logo não emite tool call nem escreve respostas — não é cérebro
de worker.

**Encaixe pretendido:** gate barato antes de cada passo e antes de cada ação irreversível.

**Resultado do spike (2026-09-26, 3 telas reais deste emulador):**

- Latência confirmada: 20–47 ms após warm-up, 67 s de carga inicial.
- Acurácia zero-shot: **5/9**.
- `has_text_input` errou as três com confiança 0,86–0,89 — erro confiante, o modo de falha que
  calibração deveria impedir, consistente com o ECE 0,204 zero-shot publicado por eles.
- `needs_confirmation` acertou a direção nas três, mas com 0,47 / 0,47 / 0,67: sem margem para
  calibrar limiar.

**Duas lições do spike, ambas sobre desenho da pergunta:**

1. Categorias sobrepostas produzem erro que parece do modelo. A tela do Play Store era
   simultaneamente `store` e `consent_dialog`.
2. **Perguntas computáveis não vão para modelo nenhum.** "Existe campo de texto?" se responde
   varrendo a árvore por nó editável: exato, grátis, determinístico. Vira regra de
   arquitetura — separar perguntas computáveis de perguntas de julgamento.

**Consequência:** Laya sai do caminho crítico e vai para a fase 6 (seção 9), sem uso zero-shot. Sequência:
workers LLM rodam, cada decisão vira exemplo rotulado, fine-tune, e então ele assume a fração
confiante. A referência publicada para esse salto é 0,362 → 0,766. Custo de entrada medido e
irrelevante: 421M params e 20 ms ao lado de 27 GB de VRAM livres.

## 5. Fluxo ponta a ponta

1. Usuário digita o objetivo.
2. Líder lê o estado da frota e decompõe, registrando o padrão (fan-out ou sharding).
3. Daemon garante os devices: boot, sonda de 4 sinais, `adb forward`.
4. Scheduler distribui para identidades ociosas e saudáveis, com starts escalonados e jitter.
5. Worker por device: estado reduzido → checagens determinísticas → decisão do modelo → tool
   call no MCP do device → repete, podando histórico.
6. Ação irreversível passa pelo gate: determinístico primeiro, modelo depois.
7. Artefatos e custo gravados por passo; resultado consolidado no objetivo.
8. Grid mostra ao vivo; ampliar assume o controle.

## 6. Tratamento de erro

| Classe | Exemplo | Resposta |
|---|---|---|
| Infra | emulador morreu, forward caiu, MCP mudo | daemon reinicia e re-sonda; tarefa volta à fila |
| Deriva de UI | nó esperado sumiu | retry com estado novo → modelo forte → `needs-human` |
| Nível de app | rate limit, checkpoint, captcha, deslogou | **para a identidade; não tenta de novo** |
| Semântico | agiu, mas errado | verificação pós-ação: tela esperada × real |
| Orçamento | passos/tokens/tempo estourados | aborta, guarda artefatos, reporta custo |

**Regra mais importante do sistema:** retry em bloqueio de plataforma transforma bloqueio leve
em banimento. Identidade custa caro para provisionar.

**Falha não bloqueia a frota:** uma identidade em `needs-human` não impede as demais de
continuarem o objetivo.

**Kill switch** para tudo e deixa os devices como estão, sem reverter snapshot, para inspeção.

## 7. Estratégia de teste

- **Unitário** na lógica pura: scheduler, alocação de portas, redução de árvore, checagens
  determinísticas. TDD normal.
- **Record-replay** como espinha dorsal do CI: fixtures de respostas reais do MCP, loop do
  worker contra telas gravadas com modelo stub. Determinístico, sem emulador.
- **Integração golden-path** com emulador real, em app próprio, sob demanda — nunca no CI.
- **Suíte de eval** do modelo: pares (tela, decisão esperada). O mesmo ativo vira o dataset de
  fine-tune do Laya.
- **Não testar** UI do Instagram em CI: não é nossa e muda sem aviso.

## 8. Modelo de dados

SQLite, escritor único (daemon).

- **identity** — id, nome, avd_name, system_image, console_port, mcp_host_port, app_alvo,
  handle_da_conta, estado, ultimo_snapshot, notas. Token e credenciais no keychain, referenciados
  por handle.
- **goal** — id, texto, padrao_decomposicao, estado, criado_em, custo_total.
- **task** — id, goal_id, identity_id (nulo = qualquer), instrucao, estado, tentativas,
  custo, criado_em, finalizado_em.
- **step** — id, task_id, indice, acao, tool, argumentos, resultado, tokens, latencia_ms,
  escalou.
- **decision_sample** — id, step_id, estado_reduzido, pergunta, resposta_do_modelo, rotulo.
  Alimenta a suíte de eval e depois o fine-tune.

## 9. Faseamento

1. **Fundação** — daemon, modelo de dados, ciclo de vida do AVD, sonda de prontidão, portas.
   Uma identidade, um device.
2. **Cockpit** — grid, ampliação com input, provisionamento manual assistido.
3. **Execução** — worker único com LLM, loop de passos, poda de histórico, gate determinístico.
4. **Enxame** — líder, decomposição, scheduler, pacing, contabilidade de custo.
5. **Provedores** — tela de configuração por papel, teste de conexão real, piso de qualidade.
6. **System 1** — coleta de `decision_sample`, fine-tune do Laya, gate calibrado.

## 10. Riscos abertos

- **Comportamental, não técnico.** A viabilidade no emulador está validada; o risco real é
  checkpoint ou banimento por padrão de automação. Mitigação parcial: pacing e a regra de não
  reagir a bloqueio com retry. Não há mitigação completa.
- **ToS.** Automação do Instagram viola os termos da plataforma mesmo com conta própria.
  Decisão do usuário, registrada aqui como restrição conhecida.
- **Play Integrity em ações.** Validamos launch e sessão; publicação e cadastro não foram
  testados.
- **Fine-tune do Laya depende de volume de dados** que só existe depois da fase 3. Se o volume
  não vier, a fase 6 não acontece e o custo por passo fica no patamar do LLM.
