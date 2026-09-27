# Onboarding de primeira execução — design

Data: 2026-09-27 · Mockup aprovado: `design/onboarding.html` (publicado em https://claude.ai/artifact/82BMNFHaw89A9azUW25RRK)

## Objetivo

Na primeira vez que o Enxame abre, uma tela em quatro passos garante que a máquina tem tudo para rodar: verifica as
dependências, deixa a pessoa escolher onde os modelos rodam, baixa e instala o que falta, e termina levando à criação
da primeira identidade. Ninguém precisa ler o README nem abrir um terminal, exceto nos três casos que exigem permissão
de administrador ou ação física (grupo `kvm`, virtualização na BIOS, chaveiro trancado) e no Node.js ausente.

## Passos (do mockup)

1. **Verificar** — resumo (prontos / para instalar / precisam de você), lista de dependências com estado, versão ou
   tamanho do download, e o cartão do computador (RAM, CPU, GPU, disco livre, quantos emuladores cabem ao mesmo tempo).
   Item "Precisa de você" bloqueia o Continuar e mostra a correção (comando copiável quando existe) e "Verificar de novo".
2. **Modelos** — três modos: Misto (recomendado com GPU), Só local, Só nuvem (padrão sem GPU NVIDIA). Lista de modelos
   do Ollama com tamanho, memória de vídeo estimada e barra de VRAM; modelo que não cabe fica desativado. Chave da
   Anthropic opcional, com "Testar chave"; fica no cofre do daemon (chaveiro do SO), nunca em arquivo.
3. **Instalar** — fila sequencial com barra por item, total baixado, log técnico recolhido. Erro para a fila e mostra
   o motivo (disco cheio, sem conexão, arquivo corrompido, falha do processo) com "Continuar download" (retoma do
   `.part`) e, no modelo, "Escolher outro modelo".
4. **Pronto** — checklist do que ficou instalado e dois caminhos: "Criar identidade" (abre Identidades) e
   "Abrir o Cockpit".

## Dependências verificadas (Linux x86_64)

| Id | O quê | Como detecta | Instala sozinho? |
|---|---|---|---|
| node | Node.js ≥ 24 (o daemon usa `node:sqlite`) | `node --version` | Não: instrução |
| sdk | Android cmdline-tools + JRE 17 próprio | `<sdk>/cmdline-tools/latest/bin/sdkmanager` | Sim |
| adb | platform-tools | `<sdk>/platform-tools/adb` | Sim (sdkmanager) |
| emu | Android Emulator | `<sdk>/emulator/emulator` | Sim (sdkmanager) |
| img | `system-images;android-34;google_apis_playstore;x86_64` | `system.img` no diretório da imagem | Sim (sdkmanager) |
| kvm | `/dev/kvm` com leitura e escrita | `fs.access` | Não: `sudo usermod -aG kvm $USER` ou BIOS |
| ollama | Ollama | `<dados>/tools/ollama/bin/ollama --version`, senão `ollama` do PATH | Sim, em `~/.local/share/enxame/tools/ollama`, sem sudo |
| model | modelo local escolhido | manifesto em `~/.ollama/models/manifests/registry.ollama.ai/library/<nome>/<tag>` | Sim (`POST /api/pull`) |
| keyring | Secret Service | `@napi-rs/keyring` lê uma entrada de teste | Não: instrução |

`<sdk>` = `ANDROID_HOME` || `ANDROID_SDK_ROOT` || `~/Android/Sdk`. Com modo "Só nuvem", ollama e model saem da lista.

## Arquitetura

- **O motor roda no processo main do Electron** (`electron/setup/`), não no daemon: o daemon precisa de Node 24 e do
  SDK para subir, então não pode ser ele quem verifica e instala essas coisas.
- **`setup.json`** em `~/.local/share/enxame/` (ou `ENXAME_DATA_DIR`): `{ version: 1, completedAt, paths: { sdkRoot, ollamaBin } }`.
  O main grava; o daemon lê na subida para achar `adb`, `emulator` e o binário do Ollama (tira os caminhos fixos de
  `/home/loterio/...` do `daemon/src/config.ts`).
- **Subida do app**: sem `setup.json` concluído, o main não sobe o daemon e a UI mostra o onboarding. Exceção: se tudo
  já estiver `ok` (instalação existente), o main grava `setup.json` como concluído sozinho e segue como hoje.
  Plataforma diferente de Linux x86_64: onboarding nunca aparece.
- **Downloads** fixados por versão e checksum (JRE Temurin 17.0.20.1+1 sha256, cmdline-tools 16111833 sha1,
  Ollama v0.34.4 sha256), com retomada por `Range` a partir de `<arquivo>.part`.
- **Fim do onboarding** (`finish`): grava `setup.json` com os caminhos, sobe o daemon, grava a chave da Anthropic
  (rota nova `PUT /settings/anthropic-key`, só pelo main), aplica os três papéis por `PUT /providers/:role` e marca
  `completedAt`.
- **Chave da Anthropic**: `ANTHROPIC_API_KEY` do ambiente continua valendo e vence; sem ela, o daemon usa a do cofre
  (`secret:anthropic`). Vale sem reiniciar o daemon.
- **Renderer**: `src/onboarding/` com reducer e seletores puros (testados em node, como o resto de `src/state`),
  componentes finos e namespace de i18n `onboarding` nos seis idiomas. `Root` decide entre onboarding e `App`.
  Provedores ganha o botão "Verificar dependências", que reabre o onboarding.

## Fora do escopo

- Instalar Node.js, entrar no grupo `kvm` ou destravar o chaveiro (pedem sudo ou ação física).
- macOS e Windows.
- Criar o AVD base com Instagram e o app MCP (continua na tela Identidades).
- LM Studio no onboarding (continua configurável em Provedores).

## Desvios do mockup

- Node.js entra na lista (o mockup não tinha; sem ele o daemon não sobe).
- O texto de "Criar a primeira identidade" diz que a pessoa vai para Identidades, em vez de prometer instalar o
  Instagram e o app de controle.
- O Pronto diz "Ollama com {modelo} no disco" (o modelo não é carregado na GPU durante o onboarding).
