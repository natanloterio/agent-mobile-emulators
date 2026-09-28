#!/bin/bash
# Instala o Tapflock no macOS sem o bloqueio do Gatekeeper.
#
#   curl -fsSL https://raw.githubusercontent.com/natanloterio/tapflock/master/scripts/install-macos.sh | bash
#
# Por que isto existe: os DMGs não têm assinatura Developer ID nem notarização (só a assinatura
# ad-hoc do scripts/adhoc-sign.cjs). Um DMG baixado pelo navegador ganha o atributo
# com.apple.quarantine e o macOS se recusa a abrir o app até a pessoa achar "Abrir Mesmo Assim" em
# Privacidade e Segurança. O curl não marca quarentena, então baixar por aqui e copiar o app para
# Applications evita o bloqueio. Em troca, a verificação da Apple não roda: por isso o download é
# conferido contra o SHA-256 que o GitHub publica para cada asset da release.
#
# O app se chamava Enxame até a 0.1.0: releases antigas trazem Enxame-*.dmg com Enxame.app, e uma
# instalação antiga em Applications é trocada pela nova.
#
# Compatível com o bash 3.2 que vem no macOS. Tudo fica em funções e main só roda na última linha,
# para que um download interrompido no `curl | bash` não execute metade do script.
set -euo pipefail

REPO="natanloterio/tapflock"
PRODUCT="Tapflock"
LEGACY_PRODUCT="Enxame"

usage() {
  cat <<'EOF'
Uso: install-macos.sh [opções]

  --version X   instala a versão X (ex.: 0.1.0); padrão: a release mais recente
  --dmg ARQ     instala a partir de um DMG já baixado, sem baixar nada
  --dest DIR    pasta de destino; padrão: /Applications (ou ~/Applications sem permissão)
  --no-open     não abre o Tapflock no fim
  -h, --help    mostra esta ajuda
EOF
}

log() { printf '==> %s\n' "$*" >&2; }
fail() { printf 'Erro: %s\n' "$*" >&2; exit 1; }

# "0.1.0" ou "v0.1.0" -> "0.1.0"
normalize_version() {
  local version="${1#v}"
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.]+)?$ ]] || fail "versão inválida: $1"
  printf '%s\n' "$version"
}

# Nomes gerados pelo electron-builder: o DMG de Intel não leva sufixo de arquitetura.
asset_name() {
  local version="$1" arch="$2" product="${3:-$PRODUCT}"
  case "$arch" in
    arm64) printf '%s-%s-arm64.dmg\n' "$product" "$version" ;;
    x86_64) printf '%s-%s.dmg\n' "$product" "$version" ;;
    *) fail "arquitetura sem instalador: $arch" ;;
  esac
}

# hw.optional.arm64 vale 1 no Apple Silicon mesmo se o terminal rodar sob Rosetta, quando
# `uname -m` diria x86_64.
detect_arch() {
  if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" = "1" ]; then
    echo arm64
  else
    echo x86_64
  fi
}

# Lê o JSON de uma release (ou de uma lista delas) da API do GitHub e imprime a primeira tag.
# Sem jq: o macOS não traz jq, e a API devolve um campo por linha. Quem chama passa o JSON por
# here-string, não por pipe: com pipefail, o awk saindo cedo derrubaria o printf com SIGPIPE.
release_tag() {
  awk -F'"' '/"tag_name":/ { print $4; exit }'
}

# Lê o JSON da release e imprime o SHA-256 do asset com o nome exato $1. Falha se não houver.
asset_digest() {
  local digest
  digest="$(awk -v target="\"name\": \"$1\"" '
    index($0, target) { found = 1; next }
    found && /"name":/ { exit }
    found && /"digest":/ {
      if (match($0, /sha256:[0-9a-f]+/)) { print substr($0, RSTART + 7, RLENGTH - 7) }
      exit
    }
  ')"
  [ -n "$digest" ] || return 1
  printf '%s\n' "$digest"
}

fetch_release_json() {
  local version="$1"
  if [ -n "$version" ]; then
    curl -fsSL "https://api.github.com/repos/$REPO/releases/tags/v$version"
  else
    # /releases/latest ignora pré-lançamentos; a lista vem da mais nova para a mais antiga.
    curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=1"
  fi
}

# Baixa o DMG da release e confere o SHA-256. Imprime o caminho do arquivo baixado.
download_dmg() {
  local version="$1" workdir="$2" json tag arch product asset="" expected=""
  json="$(fetch_release_json "$version")" || fail "não consegui consultar as releases no GitHub"
  tag="$(release_tag <<<"$json")"
  [ -n "$tag" ] || fail "nenhuma release encontrada"
  version="$(normalize_version "$tag")"
  arch="$(detect_arch)"
  for product in "$PRODUCT" "$LEGACY_PRODUCT"; do
    asset="$(asset_name "$version" "$arch" "$product")"
    expected="$(asset_digest "$asset" <<<"$json")" && break
  done
  [ -n "$expected" ] || fail "a release $tag não tem o DMG para $arch (ou o GitHub não informou o SHA-256 dele)"

  log "Baixando $asset ($tag)"
  curl -fL --progress-bar -o "$workdir/$asset" \
    "https://github.com/$REPO/releases/download/$tag/$asset" || fail "download de $asset falhou"

  actual="$(shasum -a 256 "$workdir/$asset" | awk '{ print $1 }')"
  [ "$actual" = "$expected" ] || fail "SHA-256 de $asset não confere (esperado $expected, veio $actual)"
  log "SHA-256 conferido"
  printf '%s\n' "$workdir/$asset"
}

default_dest() {
  if [ -w /Applications ]; then
    echo /Applications
  else
    echo "$HOME/Applications"
  fi
}

# App dentro do DMG montado: o atual, ou o de antes da troca de nome. Imprime o nome do bundle.
app_in() {
  local product
  for product in "$PRODUCT" "$LEGACY_PRODUCT"; do
    if [ -d "$1/$product.app" ]; then
      printf '%s.app\n' "$product"
      return 0
    fi
  done
  return 1
}

# Copia o app do DMG montado para $dest, trocando uma instalação anterior de uma vez só.
# Imprime o caminho do app instalado.
install_app() {
  local dmg="$1" dest="$2" workdir="$3" mountpoint="$3/mnt" APP_NAME
  mkdir -p "$mountpoint" "$dest"
  hdiutil attach -nobrowse -readonly -quiet -mountpoint "$mountpoint" "$dmg" </dev/null \
    || fail "não consegui montar $dmg"
  APP_NAME="$(app_in "$mountpoint")" || fail "$dmg não traz $PRODUCT.app"

  log "Copiando $APP_NAME para $dest"
  rm -rf "$dest/.$APP_NAME.new"
  ditto "$mountpoint/$APP_NAME" "$dest/.$APP_NAME.new"
  hdiutil detach -quiet "$mountpoint" || true
  rm -rf "$dest/$APP_NAME"
  mv "$dest/.$APP_NAME.new" "$dest/$APP_NAME"

  # Um DMG baixado pelo navegador (--dmg) passa a quarentena para o que sai dele.
  xattr -dr com.apple.quarantine "$dest/$APP_NAME" 2>/dev/null || true
  codesign --verify --deep --strict "$dest/$APP_NAME" \
    || fail "a assinatura de $dest/$APP_NAME é inválida; o macOS não vai abri-lo"

  # O mesmo app com o nome antigo: sobraria como um segundo ícone que abre a versão velha.
  if [ "$APP_NAME" = "$PRODUCT.app" ] && [ -d "$dest/$LEGACY_PRODUCT.app" ]; then
    log "Removendo $LEGACY_PRODUCT.app (o app agora se chama $PRODUCT)"
    rm -rf "$dest/$LEGACY_PRODUCT.app"
  fi
  printf '%s\n' "$dest/$APP_NAME"
}

main() {
  local version="" dmg="" dest="" open_app=1 workdir app
  while [ $# -gt 0 ]; do
    case "$1" in
      --version) [ $# -ge 2 ] || fail "--version precisa de um valor"; version="$(normalize_version "$2")"; shift 2 ;;
      --dmg) [ $# -ge 2 ] || fail "--dmg precisa de um arquivo"; dmg="$2"; shift 2 ;;
      --dest) [ $# -ge 2 ] || fail "--dest precisa de uma pasta"; dest="$2"; shift 2 ;;
      --no-open) open_app=0; shift ;;
      -h|--help) usage; return 0 ;;
      *) usage >&2; fail "opção desconhecida: $1" ;;
    esac
  done

  [ "$(uname -s)" = "Darwin" ] || fail "este instalador só roda no macOS"
  [ -z "$dmg" ] || [ -f "$dmg" ] || fail "arquivo não encontrado: $dmg"
  if pgrep -xq "$PRODUCT" || pgrep -xq "$LEGACY_PRODUCT"; then
    fail "o $PRODUCT (ou o $LEGACY_PRODUCT) está aberto; feche-o e rode o instalador de novo"
  fi
  [ -n "$dest" ] || dest="$(default_dest)"

  workdir="$(mktemp -d -t tapflock-install)"
  # shellcheck disable=SC2064 # workdir é fixo a partir daqui.
  trap "hdiutil detach -quiet '$workdir/mnt' 2>/dev/null || true; rm -rf '$workdir'" EXIT

  [ -n "$dmg" ] || dmg="$(download_dmg "$version" "$workdir")"
  app="$(install_app "$dmg" "$dest" "$workdir")"
  log "$PRODUCT instalado em $app"

  if [ "$open_app" = 1 ]; then
    open "$app"
  fi
}

if [ -z "${TAPFLOCK_INSTALL_SOURCED:-}" ]; then
  main "$@"
fi
