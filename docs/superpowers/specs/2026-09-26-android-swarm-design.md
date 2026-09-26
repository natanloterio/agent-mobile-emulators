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
- **Escala além de ~8–10 emuladores simultâneos.** Ver seção 3 para os três tetos.
- **Device físico.** O design assume emulador; a escolha de scrcpy na seção 4.2 preserva o
  caminho para hardware real, mas nada além disso.

O que resta em escopo: operar contas próprias ou de clientes que autorizaram, incluindo
provisionamento, execução de tarefas e verificação.

## 3. Restrições medidas

Medidas nesta máquina em 2026-09-26, não estimadas:

| Item | Valor |
|---|---|
| Host | i9-14900K (32 threads), 125 GB RAM, RTX 5090 32 GB VRAM, 397 GB disco livre |
| RSS de um emulador | 4,6 GB **com `hw.ramSize=2G` no guest** (pico 5,0 GB; multiplicador host/guest 2,16×) |
| Baseline do host sem emulador | 38,3 GiB (IDE, navegador, Docker, etc.) |
| vCPU por emulador | `hw.cpu.ncore=4` contra 32 threads de host |
| CPU de um emulador ocioso | ~48% de um core, 162 threads |
| VRAM por emulador (`-gpu host`) | 636 MiB |
| Snapshot em disco | `ram.img` = tamanho exato do guest RAM, **além** dos 3,4 GB do AVD |
| Tamanho de um AVD | 3,4 GB (cresce com dados do app) |
| Teto por RAM/CPU | 8–12 emuladores responsivos |
| **Teto duro do protocolo adb** | **16 emuladores** (varredura de portas ímpares 5555–5585) |
| Boot frio até `sys.boot_completed` | ~40 s (não re-medido; **`boot_completed` ≠ pronto**) |
| `tools/list` do servidor MCP | 57 tools, ~6,4k tokens |
| Subset de 11 tools p/ fluxo de comentários | ~1,4k tokens (−78%) |
| `android_get_screen_state` | 2,1k–2,9k tokens (média ~2,6k) |
| Preâmbulo anti-injeção por dump | ~165 tokens |
| Laya: primeira carga / inferência | 67 s / 20–47 ms **em telas 2–5× menores que o workload** |
| Laya zero-shot no nosso domínio | erro confiante reproduzido; acurácia **sem poder estatístico (n=9)** |

Contagens de token medidas com tokenizer real (`o200k_base`), não `chars/4`. **Ressalva:** é
tokenizer de outro fornecedor; a ordem de grandeza vale, o dígito não. A régua `chars/4` foi
abandonada porque erra em direções opostas: superestima schemas de tool (~chars/4,65) e
subestima a árvore de acessibilidade em 44–66% (~chars/2,5–2,8, por causa dos `node_<hash>`,
tabs, `res_id` e tuplas de coordenada).

**Alvo de escala: 8 identidades simultâneas, tudo local; 10 como esticada a validar.**
Revisado para baixo depois da revisão adversarial: 10 era um alvo derivado só de RAM. Os três
tetos independentes são 16 (protocolo adb), 8 (CPU) e 8–10 (RAM, conforme `hw.ramSize`). Vale
o menor.

`hw.ramSize` é restrição de primeira ordem e precisa ser declarada, não herdada do default:

**Duas definições que faltavam, porque sem elas os números não querem dizer nada:**

- **"Responsivo"** é um SLA, não impressão: p95 de `android_get_screen_state` abaixo de um
  limite declarado, sob carga real. O teto de emuladores é derivado do recurso mais restritivo
  que ainda cumpre esse SLA — hoje, CPU.
- **"Tempo de frota pronta"** é requisito de produto, não detalhe de implementação: num sistema
  "objetivo e sai de perto", é quanto o usuário espera entre mandar o objetivo e a frota estar
  operando. `sys.boot_completed` é só o primeiro dos cinco sinais; accessibility, servidor MCP e
  Play Services vêm depois. Medir e declarar, incluindo o efeito dos starts escalonados.

**CPU é teto independente e mais apertado que RAM.** Com `hw.cpu.ncore=4`, dez identidades
pedem 40 vCPU contra 32 threads: **1,25× de oversubscrição antes de qualquer trabalho**, e um
emulador ocioso já consome ~48% de um core só existindo — dez ociosos são ~5 cores. Somam-se
a isso o dump de árvore de acessibilidade, o encode de vídeo por software dentro do guest
(seção 4.2) e, se houver modelo local, a inferência na mesma máquina. **Por CPU o teto é 8.**

| n | guest | RAM total com baseline | cabe em 125,6 GiB |
|---|---|---|---|
| 8 | 2G | 74,9 GiB | sim |
| 10 | 2G | 83,6 GiB | sim |
| 12 | 2G | 92,2 GiB | sim |
| 10 | **4G** | **126,9 GiB** | **não** |

**Tensão não resolvida:** 2G de guest é apertado para Instagram + Play Services + serviço de
acessibilidade + app MCP no Android 14, e a seção 4.1 exige que o cache do app **acumule** —
o que empurra para 4G, onde o alvo de 10 deixa de caber. Decidir por medição na fase 1:
rodar uma identidade a 2G sob carga real e observar `lowmemorykiller`. Se 2G não servir, o
alvo cai para ~8.

**Disco:** os 3,4 GB do AVD **não incluem o snapshot**. O `ram.img` tem exatamente o tamanho
do guest RAM (confirmado em AVDs desta máquina: guest de 4G gera snapshot de 4,1 GB). Como a
seção 4.1 exige re-snapshot a cada execução, o snapshot é permanente, não eventual:

| guest | AVD + crescimento | snapshot | por identidade | × 10 |
|---|---|---|---|---|
| 2G | ~4–5 GB | 2,1 GB | ~6–7 GB | **60–70 GB** |
| 4G | ~4–5 GB | 4,3 GB | ~8–9 GB | **80–90 GB** |

Cabe, mas com três condições que o spec precisa fixar em vez de herdar:

- **`hw.ramSize` e `dataPartition.size` são restrições versionadas da imagem-base.** Os números
  acima pressupõem 2G e 6G; nenhum dos dois era declarado, e A4 argumenta que o guest vai
  precisar subir.
- **Política de ocupação por identidade.** A seção 4.1 manda o cache do app acumular, e a
  partição é fixa: quando enche, o Android descarta cache e depois o app quebra. Precisa de
  alerta de ocupação e procedimento de re-baseline (recriar a identidade a partir do snapshot
  limpo, preservando a conta). AVDs antigos desta máquina mostram o destino sem política:
  `Pixel_7.avd` com 23 GB.
- **`ANDROID_AVD_HOME` pinado no disco certo.** O default fica em `~/.android/avd`, na
  partição a 78% de uso, que já carrega 62 GB de outros AVDs e 33 GB de system images —
  enquanto o volume de trabalho tem 1,1 TB ociosos. **Suspeita não medida:** dez emuladores
  escrevendo qcow2 no mesmo NVMe durante o boot simultâneo do passo 3 da seção 5 é contenção
  de I/O que ninguém verificou.

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
permissões concedidas, `auto_start_on_boot` ligado, auto-update da Play Store desligado,
`hw.ramSize`, `dataPartition.size` e a configuração de GPU **fixadas e versionadas** (hoje
`hw.gpu.enabled=no` no `config.ini` coexiste com `-gpu host` na linha de comando, e o consumo
de VRAM da seção 3 depende de qual dos dois venceu),
nenhuma conta de terceiro, **e sem bloqueio de tela por credencial** (PIN/padrão/senha): com credencial, o
Android segura o storage criptografado do usuário até o primeiro desbloqueio manual (Direct Boot, tela
`FallbackHome`) e nenhum app de terceiro resolve — um reboot deixa a identidade inoperante até alguém
digitar o PIN, o que anula a recuperação headless. Observado em 2026-09-26 no relançamento do emulador.
**Sem token e sem `device_slug`** — ver abaixo. Snapshot.

**Materialização.** Clonar o AVD-base, novo nome e serial. **Token e `device_slug` são
gerados por identidade neste momento, nunca na imagem-base:** o servidor MCP gera o token
uma vez no primeiro launch e o preserva, então configurá-lo antes de clonar faria todos os
clones nascerem com o mesmo segredo e o token deixaria de distinguir device algum.

Login acontece **uma vez**, em janela visível, feito por humano — validado na prática: o
Instagram foi logado manualmente e funcionou. Snapshot vira o ponto de restauração daquela
identidade, com `snapshot_taken_at` registrado.

**Acesso exclusivo por lease, não por convenção.** Todo device tem um único dono de cada vez:
`lease_owner` + `lease_expires_at` + heartbeat na tabela `identity`, concedidos pelo daemon.
Um worker sem lease válido não fala com o device. Isolamento só no prompt — "o worker não
sabe dos outros devices" — não é controle de acesso: no host, `adb forward` expõe cada
servidor em `127.0.0.1:<mcp_host_port>` e qualquer processo com o token dirige qualquer
device. Combinado com um erro de alocação de porta, isso age na conta errada em silêncio, e
a ação é irreversível.

**Snapshot não é reset por execução.** Numa conta persistente o histórico e o cache do app
devem se acumular; reverter a cada job descarta continuidade e faz a conta parecer um device
recém-formatado toda vez. Snapshot é recuperação de desastre.

**Snapshot tem prazo de validade, e restaurar não é gratuito.** Um snapshot congela o token
de sessão do app do momento em que foi tirado. Restaurar semanas depois reapresenta uma
sessão obsoleta, com o relógio do guest vindo do `ram.img`, o que tende a forçar re-login —
e re-login de uma sessão que reaparece após silêncio é justamente o tipo de sinal
comportamental que a seção 10 identifica como risco principal. O mecanismo de recuperação é
também um gatilho do evento que ele deveria curar. Portanto:

- re-snapshot a cada execução bem-sucedida, substituindo o anterior, para que o ponto de
  restauração nunca fique velho;
- `snapshot_taken_at` acima de um limite configurável marca a identidade como
  `restore-unsafe`: restaurar exige confirmação humana, não acontece automaticamente;
- restauração sempre seguida de verificação de sessão antes de qualquer tarefa; sessão
  inválida vira `needs-human`, não re-login automático.

**Estado terminal existe.** O ciclo inclui `banned`, com `banned_reason` e `banned_at`.
Identidade banida sai do scheduler por dado, não por alguém editar o estado à mão, e o
usuário tem um procedimento explícito: exportar o que houver de artefato, **liberar os 3,4+ GB
de disco** descartando o AVD, e provisionar uma identidade nova a partir da imagem-base. Sem
isso, cada banimento deixa disco preso a uma conta morta e o sistema degrada em silêncio.

**Ciclo de vida:** `blank → provisioned → logged-in → running → dirty → restored`, mais o
terminal `banned`.

**Sonda de prontidão.** Um device entra na frota apenas com os cinco sinais verdes:
`sys.boot_completed=1`, accessibility service ativo, `initialize` HTTP 200, `tools/list`
com **as tools que o workload usa presentes** — presença, nunca contagem: o servidor está numa
versão `-dev` e um tool novo no upstream derrubaria a sonda em todos os devices ao mesmo tempo
—, e **`versionName` do app alvo igual ao registrado na identidade**.
Roda a cada subida do device.

O quinto sinal existe porque a imagem Play Store traz auto-update ligado e o app alvo se
atualiza sozinho — o Instagram, semanalmente. Sem ele, um update silencioso invalida as
fixtures do CI (seção 7) e o worker descobre a mudança como "tela inesperada" no meio de um
job, escalando para o modelo forte por um motivo que não é deriva de UI. Com ele, o device
simplesmente não fica pronto e o usuário é avisado **antes** do job rodar.

Defesa em profundidade, na ordem: auto-update desligado na imagem-base; versão do APK pinada
onde a distribuição permitir; sonda como rede final, porque nenhuma das duas primeiras é
garantida contra atualização forçada pela plataforma.

**Alocação de portas.** Cada identidade tem uma reserva de `console_port` (par, a partir de
5554) e de `mcp_host_port` (a partir de 8080). Três exigências que uma fórmula estática não
atende:

- O emulador sobe com **`emulator -port <console_port>`** (singular — o adbport é derivado
  como `console_port + 1`). Sem essa flag ele auto-seleciona o primeiro par livre e o
  mapeamento gravado no banco vira ficção na primeira mudança de ordem de boot.
- Com `-port`, **se a porta não estiver livre o emulador encerra** em vez de escolher outra.
  Socket em `TIME_WAIT` ou processo qemu zumbi da execução anterior basta para isso. O daemon
  portanto **verifica a porta antes de subir** e, se estiver presa, faz lease do próximo slot
  livre e atualiza o registro da identidade — a porta é um recurso alocado dinamicamente e
  persistido, não uma função do índice.
- O teto de 16 identidades da seção 3 é consequência direta disso: acima do slot 15 o adb
  deixa de enxergar o device.

`adb forward` é outra coisa e não substitui nada acima: ele só expõe o servidor MCP do device
em `mcp_host_port` no host.

**O adb server é recurso de frota, não de device.** Um único processo `adb` detém todos os
forwards, e um cliente adb de versão diferente mata esse processo e derruba **todos** de uma
vez. Nesta máquina já convivem três binários: `/usr/bin/adb` 34.0.4-debian (primeiro no PATH),
o 37.0.0 do SDK, e o que o scrcpy 4.1 traz embutido. Android Studio, gradle, plugins de IDE e
o Makefile do repo do servidor MCP também disparam adb. Consequências no design:

- O daemon roda um adb server **próprio e isolado** (`ANDROID_ADB_SERVER_PORT` dedicado), com
  binário pinado e empacotado no app; o scrcpy é configurado para o mesmo server.
- Perda de forward é tratada como **evento de frota**: reconciliação de todos os forwards
  contra o registro, não reparo de um device.

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
scrcpy também serve device físico e já traz injeção de input. Requisito: **scrcpy ≥ 4.x** e
binário **empacotado no app**, não dependente da máquina. O 1.25 distribuído por apt falha ao
injetar toque no Android 14 (`AssertionError` sobre `InvocationTargetException` em
`Device.injectEvent`, com `NullPointerException` na raiz).

**Pendência bloqueante da fase 2, não requisito resolvido:** verificou-se que o 4.1 **renderiza**
no Android 14; **não** se verificou que ele **injeta toque**. Como a tela ampliada com input é
a única interface de provisionamento — é assim que o humano loga a conta — a fase 2 depende de
uma capacidade ainda não demonstrada. Primeiro item da fase 2: injetar um toque pelo 4.1 e
confirmar o efeito pela árvore de acessibilidade. Se falhar, a alternativa é janela nativa do
emulador para provisionar e streaming só para visualização.

**Três correções no modelo de custo de vídeo:**

- O encoder é **software dentro do guest** (`c2.android.avc.encoder`). O custo de encode de N
  streams não é do host: é CPU do guest, competindo com o app sob automação. A conta
  "N−1 baratos + 1 caro" está no lugar errado e nunca foi medida.
- A conta "N−1 baratos + 1 caro" **nunca foi medida** e precisa ser, com 4+ streams reais,
  antes de sustentar o teto de frota.
- **`WebCodecs` está afirmado como resolvido e é suspeita, não certeza.** Dez `VideoDecoder`
  num renderer Electron sobre Wayland + NVIDIA é combinação historicamente instável, que cai
  para decode por software sem avisar. Evidência local: nesta máquina o Claude Desktop roda com
  `--use-gl=disabled` e o VS Code com `--render-node-override`. Spike de 10 decoders antes da
  fase 3.
- O scrcpy liga **áudio** por padrão (`c2.android.opus.encoder`), inútil aqui: `--no-audio`
  em todos os streams.
- Dirigir `scrcpy-server` a partir de um daemon Node implica **reimplementar seu protocolo
  binário privado**, sem garantia de estabilidade entre major versions (o server saltou de
  41 KB no 1.25 para 734 KB no 4.1). Isso é superfície de manutenção contínua, exatamente o
  que a seção 2 excluiu. Decisão em aberto, a resolver na fase 2 com spike: usar um cliente
  scrcpy existente como processo, ou usar a gRPC do emulador para o grid e reservar scrcpy só
  para a tela com controle.

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

**Recuperação de crash e idempotência.** SQLite em WAL não é gargalo para dez devices a um
passo cada poucos segundos — essa parte está resolvida. O problema é o outro lado da mesma
decisão: se o daemon morre, os emuladores continuam com ações em voo e o banco não sabe
quais. Sem isso, na volta é impossível distinguir *"ia tocar Enviar"* de *"toquei Enviar e
não sei o resultado"* — e para ação irreversível o erro é comentário duplicado, o mesmo padrão
que a seção 10 associa a checkpoint. Portanto, e alinhado ao que o próprio servidor MCP exige
de operações retryáveis:

- **intenção escrita antes da ação** (write-ahead) com `started_at`, e conciliação na volta;
- **chave de idempotência por ação** derivada de (identidade, item externo, tipo de ação);
- ação em voo sem conclusão registrada **nunca** é repetida automaticamente: vira verificação
  de estado real no device, e só então decide.

**Fila em SQLite com escritor único (o daemon).** Divergência deliberada do `agent-team`, que
usa fila em arquivos: lá o worktree git é a unidade de isolamento; aqui o daemon já é dono de
todo o estado e o dashboard precisa de query.

**Worker por device.** Sessão longa, um device apenas, carregando o contexto daquela
identidade. Herdamos do `agent-team` a forma (líder / worker / verificação) e não a
implementação — não há repo, worktree nem PR; o artefato é ação num app.

**Escopo de tools por worker.** Cada worker enxerga só o MCP do seu device. Dar os N devices
a um worker seriam 57×N definições por turno e risco de agir na conta errada. O `device_slug`
do app deixa o nome da tool inequívoco no log (`android_conta3_tap`).

**Economia de tokens.** Estimativa de referência para responder comentários numa conta:
**40–60 passos**, não 20. Com ~2,6k por tela e 50 turnos, sem poda são ~3,6 M tokens por
conta.

1. **Poda de histórico** — o maior lever, isolado: corta ~84%, de 3,6 M para ~578 k por conta.
   Manter os últimos 1–2 estados.
2. **Subset de tools por workload** — depois da poda, as definições de tool viram **~55% do
   que sobrou**, e o subset corta ~43% desse restante. Deixa de ser margem e passa a ser o
   segundo maior item.
3. **Prompt caching** — real, porém menos somável do que parece, por três tensões que o design
   precisa resolver em vez de ignorar:
   - subset por workload **quebra o prefixo exato** de cache: cada variante é uma entrada;
   - `device_slug` torna os nomes de tool distintos por device (`android_conta3_tap`), o que
     significa **um cache por identidade**, cada um com seu custo de escrita;
   - o pacing da seção adiante espaça ações de propósito, e cache com TTL de 5 min expira
     entre passos. Mitigação: **TTL estendido de 1 h**, e o teto de ações/hora por identidade
     é definido em conjunto com o TTL, não isoladamente.

**Memória de tarefa é durável, não contextual.** Poda resolve custo e cria um problema de
correção: um worker que só enxerga os últimos 2 estados não sabe quais comentários já
respondeu, e responder duas vezes é irreversível e visível para terceiros. Logo o worker
consulta e grava um **ledger de itens tratados** (tabela `step` mais um índice por
identidade e item externo) antes de agir, e o teto de contexto é declarado: ao aproximar-se
dele a tarefa é encerrada e continuada numa sessão nova a partir do ledger, nunca truncada
em silêncio.

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
| Worker por device | 40–60 passos × N contas | barato e rápido — onde local ganha |
| Escalonamento | raro | modelo forte |

**A VRAM é disputada por três consumidores, não um.** Com `-gpu host` cada emulador ocupa
636 MiB de VRAM; dez ocupam ~6,4 GiB dos 32 GB. Sobra para o modelo local:

| n devices | VRAM livre | menos pesos 30B-4bit (~19 GiB) = KV cache |
|---|---|---|
| 8 | 23,7 GiB | 4,7 GiB |
| 10 | 22,4 GiB | **3,4 GiB** |

**Consequência não resolvida:** o vLLM pré-aloca a maior parte da VRAM livre para KV cache, e
com ~3,4 GiB não cabem dez sequências concorrentes de ~13k tokens. "Concorrência é o gargalo,
e vLLM aguenta" é verdade em geral e **não foi testada nesta configuração**, que é a única que
importa. Saídas, a decidir por medição: modelo local menor, menos devices, `-gpu
swiftshader_indirect` nos emuladores (libera VRAM ao custo de CPU, que a seção 3 já mostra
apertada), ou worker em nuvem e GPU reservada só para a camada System 1.

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

- **O spike tem n=9** (3 telas × 3 perguntas). 5/9 dá IC 95% de aproximadamente [0,27; 0,81] —
  indistinguível tanto do 0,362 zero-shot quanto do 0,766 pós-fine-tune que serve de referência
  aqui. **A acurácia medida não sustenta conclusão** e não é usada como tal: a decisão de adiar
  o Laya se apoia no motivo estrutural (não emite tool call), não neste número.
- O que **sobrevive** como evidência: `has_text_input` errou as três com confiança 0,86–0,89, e
  o rótulo foi conferido (nenhuma das três telas tem nó editável). Erro confiante reproduzido é
  qualitativo e não depende de tamanho de amostra — é o modo de falha que calibração deveria
  impedir, consistente com o ECE 0,204 publicado por eles.
- `needs_confirmation` acertou a direção nas três, com 0,47 / 0,47 / 0,67: sem margem de limiar.
- Latência medida em telas de 1,3–3,3k chars, enquanto telas reais chegam a ~7k. **Re-medir no
  tamanho do workload antes de tratar o custo como desprezível.**

**Duas lições do spike, ambas sobre desenho da pergunta:**

1. Categorias sobrepostas produzem erro que parece do modelo. A tela do Play Store era
   simultaneamente `store` e `consent_dialog`.
2. **Perguntas computáveis não vão para modelo nenhum** — mas computável é sobre a
   **affordance**, não sobre a presença do nó. O exemplo que usei no spike demonstra o modo de
   falha da própria regra: no launcher não existe nenhum nó editável, e mesmo assim dá para
   digitar, tocando antes no `FrameLayout` de busca (`desc:Search`, `clk,foc`). A resposta
   determinística "não há campo de texto" é exata sobre a árvore e enganosa sobre o que o
   agente consegue fazer — e isso na primeira tela de todo job.
   A regra correta é: pergunta computável é a que se responde por uma propriedade estável da
   árvore (existe nó com este `res_id`? este nó está habilitado? a tela mudou?). "Consigo
   digitar aqui com no máximo um toque?" é julgamento disfarçado de consulta. **Quem classifica
   cada pergunta em qual balde é decisão de design registrada, não escolha do implementador.**

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
| Infra (device) | emulador morreu, MCP mudo | daemon reinicia, re-sonda, faz lease de porta se a antiga estiver presa; tarefa volta à fila |
| **Infra (frota)** | **adb server morto, todos os forwards caíram** | **reconcilia a frota inteira contra o registro; pausa o scheduler até a sonda passar em todos** |
| Versão do app | `versionName` mudou desde o último job | device não fica pronto; avisa antes de executar; fixtures do CI marcadas como suspeitas |
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
  worker contra telas gravadas com modelo stub. Determinístico, sem emulador. **Cada fixture
  grava o `versionName` do app de origem**; quando a versão instalada diverge, o CI falha
  dizendo que a fixture envelheceu, em vez de passar testando uma UI que não existe mais.
- **Integração golden-path** com emulador real, em app próprio, sob demanda — nunca no CI.
- **Suíte de eval** do modelo: pares (tela, decisão esperada), com **papel de gate de
  release** — não é um teste par dos outros. Precisa de tamanho mínimo declarado e limiar
  numérico de aprovação antes de servir para alguma coisa; o conjunto existente hoje tem 9
  exemplos, que não decide nada. O mesmo ativo vira o dataset de fine-tune do Laya.
- **Não testar** UI do Instagram em CI: não é nossa e muda sem aviso.

**O que o record-replay não cobre**, explicitado para que CI verde não seja confundido com
sistema funcionando: se o modelo escolhe a tool certa; se a escada de escalonamento dispara na
hora certa — o gatilho é "tela inesperada N vezes", que é comportamento de modelo; se o gate de
ação irreversível pega o caso, já que a metade-modelo do gate está stubbada e o replay só
exercita a metade determinística; e tudo que é timing, pacing e jitter. Isso é território da
suíte de eval e da fase 1 vertical, não do CI.

## 8. Modelo de dados

SQLite, escritor único (daemon).

- **identity** — id, nome, avd_name, system_image, console_port, mcp_host_port (ambas
  **alocadas por lease e persistidas**, não derivadas do índice), app_alvo,
  app_version_name (comparada pela sonda), handle_da_conta, estado, snapshot_taken_at,
  lease_owner, lease_expires_at, banned_reason, banned_at, notas. Token e credenciais no keychain, referenciados
  por handle.
- **goal** — id, texto, padrao_decomposicao, estado, criado_em, custo_total.
- **task** — id, goal_id, identity_id (nulo = qualquer), instrucao, estado, tentativas,
  custo, criado_em, finalizado_em.
- **step** — id, task_id, indice, acao, tool, argumentos, resultado, tokens, latencia_ms,
  escalou, **started_at, idempotency_key, intent_written_at** (recuperação de crash).
- **decision_sample** — id, step_id, estado_reduzido, pergunta, resposta_do_modelo, rotulo,
  **rotulo_origem**. Alimenta a suíte de eval e depois o fine-tune.

`rotulo` e `resposta_do_modelo` são colunas distintas de propósito, e `rotulo_origem` declara
de onde o rótulo veio, porque isso decide o que a suíte mede:

- `outcome` — derivado do resultado observado (a verificação pós-ação passou? a tela seguinte
  foi a esperada?). Barato, não vem do modelo, e é a fonte preferida.
- `human` — revisão manual, usada em amostragem por conferência e nos casos que `outcome` não
  decide. É custo real e precisa ser orçado, não presumido.
- `model` — saída do próprio LLM. Aceitável apenas para pré-triagem, **nunca** como verdade da
  suíte de eval nem do fine-tune do gate.

## 9. Faseamento

Ordenado por **risco descoberto**, não por camada construída. A ordem anterior — fundação,
cockpit, execução, enxame — construía daemon, banco e frota inteira antes de testar se a
plataforma tolera a terceira resposta automatizada, que a seção 10 identifica como o risco
dominante. Também entregava uma fase 1 sem valor observável: um processo que sobe um AVD e
diz que está pronto é o que `emulator -avd X && adb wait-for-device` já faz.

1. **Fatia vertical, uma identidade** — login manual na janela nativa do emulador, um worker
   LLM executando **uma tarefa real ponta a ponta** no app alvo, começando por ações
   reversíveis antes de qualquer publicação. Sem daemon, sem banco, sem grid: script e um
   device. Entregável observável: uma ação real feita por agente, com custo medido.
   Resolve de uma vez as pendências mais caras: injeção de input (seção 4.2), `hw.ramSize`
   sob carga real (seção 3), custo real em tokens por tarefa (seção 4.3) e — o principal —
   como a conta reage, com **uma** identidade em jogo em vez de dez.
2. **Endurecer o caminho único** — daemon com adb server isolado e binário pinado, modelo de
   dados, ciclo de vida do AVD, sonda de 5 sinais, lease de portas, lease de device,
   intenção write-ahead e idempotência. Infraestrutura agora com consumidor provado.
3. **Cockpit** — grid e tela ampliada com controle; decisão grid por gRPC × scrcpy, já
   informada pelo spike da fase 1.
4. **Enxame** — líder, decomposição, scheduler, pacing, contabilidade de custo.
5. **Provedores** — tela por papel, teste de conexão real, piso de qualidade.
6. **System 1** — coleta de `decision_sample`, fine-tune do Laya, gate calibrado. **Só começa
   com a procedência do rótulo resolvida** (ver seção 8): rótulo vindo do próprio LLM torna o
   fine-tune uma destilação que herda os erros do professor, e a suíte de eval passa a medir
   concordância com o modelo anterior em vez de correção — o oposto da premissa de que o Laya
   seja um gate mais confiável.

**Critério de parada entre 1 e 2:** se a fase 1 mostrar que a conta recebe checkpoint com
volume baixo de automação, o projeto muda de forma antes de existir frota — e o custo dessa
descoberta terá sido uma identidade e alguns dias, não seis fases.

## 10. Riscos abertos

- **Comportamental, não técnico.** A viabilidade no emulador está validada; o risco real é
  checkpoint ou banimento por padrão de automação. Mitigação parcial: pacing e a regra de não
  reagir a bloqueio com retry. Não há mitigação completa.
- **ToS.** Automação do Instagram viola os termos da plataforma mesmo com conta própria.
  Decisão do usuário, registrada aqui como restrição conhecida.
- **Play Integrity em ações.** Validamos launch e sessão; publicação e cadastro não foram
  testados.
- **Auto-update do app alvo é o evento adverso mais frequente**, não o banimento: o Instagram
  atualiza cerca de toda semana, e um update invalida fixtures e derruba N identidades ao
  mesmo tempo. Mitigado pela sonda de 5 sinais, nunca eliminado.
- **Snapshot envelhecido é risco ativo, não inerte:** restaurar um ponto antigo pode provocar
  o checkpoint que a restauração tentava resolver. Ver seção 4.1.
- **Bloqueio de tela por credencial** numa identidade transforma qualquer reboot em intervenção manual.
  A imagem-base não pode ter lock; login no Google/Instagram costuma sugerir criar um — recusar.
- **Injeção de input pelo scrcpy não está demonstrada** no Android 14 com a versão escolhida.
  Bloqueia a fase 2 até o spike.
- **Fine-tune do Laya depende de volume de dados** que só existe depois da fase 3. Se o volume
  não vier, a fase 6 não acontece e o custo por passo fica no patamar do LLM.
