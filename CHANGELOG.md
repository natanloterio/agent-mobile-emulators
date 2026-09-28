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
