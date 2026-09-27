# Runtimes locais: Ollama e LM Studio

**Data:** 2026-09-27 · **Estende:** spec inc. 2 (provedor local) e inc. 3 §4.5 (seletor de modelos)

## Objetivo

O seletor de modelo de um papel local lista os modelos **já baixados** na máquina, de todos os runtimes locais instalados, mesmo com o servidor do runtime parado. Ollama e LM Studio atrás da mesma interface.

## Decisões

| decisão | escolha |
|---|---|
| runtime por papel | coluna `provider_config.runtime` (`ollama` \| `lmstudio`, só no modo local); trocar o runtime sem dizer o endpoint volta ao default dele |
| endpoints default | Ollama `http://127.0.0.1:11434/v1`, LM Studio `http://127.0.0.1:1234/v1` (ambos OpenAI-compatible: o worker não muda) |
| listar Ollama | servidor no ar: `GET /api/tags`; parado: manifests em `$OLLAMA_MODELS` ou `~/.ollama/models/manifests` (`library/<nome>/<tag>` → `nome:tag`) |
| listar LM Studio | `lms ls --json` (CLI em `~/.lmstudio/bin/lms` ou no PATH; funciona com o servidor parado), só `type: llm`; estado carregado por `GET /api/v0/models` se o servidor responder |
| subir LM Studio | `lms server start --port <porta>`; modelo não carregado → `lms load <modelKey> --context-length 32768 -y`; confirma pelo `/api/v0/models` |
| despacho | `ensure(endpoint, model, runtime?)`: sem runtime, a porta 1234 indica LM Studio e o resto Ollama |

## Contrato

`GET /providers/models?role=X` (papel local):

```ts
{
  source: 'local',
  models: string[],               // ids do runtime atual do papel (compatível com a tela antiga)
  error: string | null,           // erro do runtime atual (ex.: "Ollama parado — …")
  runtimes: { kind: 'ollama' | 'lmstudio'; label: string; endpoint: string; installed: boolean; running: boolean; error: string | null }[],
  entries: { id: string; runtime: 'ollama' | 'lmstudio'; label: string; sizeBytes: number | null; loaded: boolean | null; toolUse: boolean | null }[],
}
```

Papel na nuvem: `{ source: 'anthropic', models, error: null }` como hoje.

`PUT /providers/:role` aceita também `runtime`. O snapshot (`providers[role]`) passa a trazer `runtime` (`null` na nuvem).
