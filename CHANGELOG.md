# Changelog

## Não lançado

### Mudou
- O projeto agora se chama **Tapflock** (antes, Enxame). App, instaladores, repositório, pasta de dados
  (`~/.local/share/tapflock`), serviço no chaveiro, variáveis de ambiente (`TAPFLOCK_*`) e AVDs novos (`tapflock_*`).

### Migração
- Na primeira execução, a pasta `~/.local/share/enxame` vira `~/.local/share/tapflock` (o daemon antigo, se ainda
  estiver rodando, é parado antes), o banco `enxame.sqlite` vira `tapflock.sqlite` e os caminhos do `setup.json` são
  atualizados. Se não der para mover (arquivo aberto no Windows, por exemplo), tudo segue no nome antigo e a próxima
  execução tenta de novo.
- A chave do cofre é copiada do serviço `enxame` para `tapflock` no chaveiro do sistema (a antiga fica, para uma
  versão anterior ainda abrir o cofre); o perfil do Electron (idioma
  escolhido) passa de `Enxame` para `Tapflock`.
- Identidades existentes seguem com os AVDs `enxame_*` e os snapshots `enxame`; a base `enxame_golden` ainda é usada
  quando não existe `tapflock_golden`. Variáveis `ENXAME_*` continuam valendo quando a `TAPFLOCK_*` correspondente
  não está definida.
- O `.deb` substitui o pacote `enxame`; o instalador de uma linha do macOS remove o `Enxame.app` antigo. No Windows,
  desinstale o Enxame pelas Configurações.

### Primeiro uso
- O fim do onboarding que falhou (chave ou papéis) não conta mais como concluído: na próxima abertura o onboarding
  volta, em vez de o app abrir com os papéis padrão e a escolha de modelos perdida.
- "Só nuvem" sem chave da Anthropic não deixa instalar (os agentes não teriam modelo). Erros do rodapé do onboarding
  aparecem em vermelho, e o fim que falhou oferece "Tentar de novo".
- Celular-base (o AVD que toda identidade copia): o passo Pronto, o Cockpit vazio e Identidades mostram o que fazer
  quando ele não existe ou está ligado, e Provisionar fica travado até ele existir e estar desligado. O daemon percebe
  a base criada com o app aberto, sem reiniciar, e o guia fica visível até a primeira identidade.
- Daemon que não sobe: a tela diz o motivo (fechou na subida ou não respondeu) e onde está o log, com "Tentar de
  novo", em vez de ficar em "Conectando ao daemon…" para sempre. A porta padrão ocupada (por exemplo, pelo daemon de
  uma versão anterior) não derruba mais o daemon: ele usa outra porta livre. Uma trava na pasta de dados
  (`daemon.lock`) garante um daemon só por pasta; o segundo sai com código 3 e o app espera o que já roda.
- Provedores ganhou o cartão da chave da Anthropic: diz se há chave e de onde veio, e testa antes de salvar.

### Acabamento de UX
- "Novo objetivo" virou "Nova missão" no menu e no Cockpit (o modo objetivo está oculto; a tela já era de missão).
  O modo demonstração mostra a mesma tela de missão do app de verdade.
- Kill switch pede confirmação na própria tela; acionado, o botão trava e o cabeçalho diz "Parado pelo kill switch"
  (antes seguia "Objetivo em execução").
- Cockpit mostra primeiro quem precisa de alguém (atenção, depois offline); o tile não mostra mais resolução e fps.
- Erros do daemon aparecem no idioma da tela (cerca de 30 mensagens conhecidas, com os parâmetros); o "Ollama
  parado — o próximo teste o sobe" não aparece mais duplicado como erro em Provedores.
- Identidade com o app alvo atualizado sozinho ganha "Aceitar a versão instalada" (rota
  `POST /identities/:id/accept-version`), em vez de ficar fora da frota sem nada a fazer.
- Onboarding: seletor de idioma no próprio onboarding; grupos de escolha (modo e modelo) com um ponto de Tab e setas.
- Identidades: PIN com rótulo visível, estados como legenda (não parecem filtros), portas discretas. Provedores com
  textos sem jargão ("Memória de vídeo", "Planeja cada missão · roda pouco"…). Menu do celular com os nomes inteiros.

### Celular-base automático
- O Tapflock prepara o celular-base sozinho, sem Android Studio: cria o AVD (`avdmanager` com o Java do onboarding),
  sobe com janela, baixa o app Android Remote Control MCP v1.12.0 (sha256 fixo), instala pelo adb e liga acessibilidade
  e início automático. Pede uma conta Google uma vez (cofre do sistema) e roda uma missão no celular-base que entra na
  Play Store, instala o Instagram e remove a conta Google do aparelho (clones não herdam a conta). Verificação do
  Google aparece no cartão com "Continuar". No fim grava a versão instalada como oficial (identidades novas são
  conferidas contra ela), desliga a Play Store da base e o emulador. Cada fase pula o que já está feito: "Tentar de
  novo" retoma de onde parou.
- O guia manual de Android Studio saiu das telas (Identidades, passo Pronto, Cockpit vazio).
- A linha reservada `base` (portas e token do celular-base) fica fora da frota: snapshot, objetivos, testes de provedor.

### Consistência
- Botão desabilitado agora parece desabilitado (antes era igual ao ativo).
- "Precisam de você" conta a mesma lista que o Relatório mostra (antes identidades offline ficavam fora do número).
- Checkpoint no Device: o botão principal é "Assumir controle para resolver"; no controle, um botão só marca
  resolvido e devolve ao agente. "Resolvi, devolver à fila" fica como secundário.

## 0.1.0 — pré-lançamento

Primeira versão pública.

### O que tem
- Cockpit com vídeo ao vivo de cada emulador, kill switch e controle manual.
- Objetivos divididos pelo líder em tarefas por identidade; missões longas com retry e credenciais no cofre.
- Provedores na nuvem (Anthropic) e locais (Ollama, LM Studio), com limites de passos ajustáveis.
- Onboarding de primeira execução que verifica e instala Android SDK (com Java próprio), emulador, imagem Android 14
  com Google Play, Ollama e um modelo local, sem sudo, em Linux x64, macOS (Intel e Apple Silicon) e Windows x64.
- Interface em português, inglês, espanhol, francês, alemão e chinês.
- Instaladores: AppImage e .deb (Linux), .dmg (macOS), instalador NSIS (Windows).

### Limitações conhecidas
- macOS e Windows: a instalação automática completa foi validada só por testes automatizados e smoke test no CI.
- Instaladores sem assinatura: o macOS e o Windows avisam na primeira abertura (veja o README).
- Windows: ligar a Plataforma de Hipervisor exige administrador e reinício; o app mostra o comando.
- O AVD base (enxame_golden) ainda é criado à mão.
- Traduções es/fr/de/zh sem revisão nativa.
