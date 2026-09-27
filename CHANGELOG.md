# Changelog

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
