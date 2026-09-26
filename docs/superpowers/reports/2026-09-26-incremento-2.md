# Incremento 2 — bake-off e benchmark (2026-09-26T15:49:15.551Z)

- Sonda: {"bootCompleted":true,"accessibility":true,"mcpInitialize":true,"toolsPresent":true,"versionMatch":true}
- Modelos: qwen3.5:27b, gpt-oss:20b, gemma4:12b, qwen2.5-coder:14b · 3 testes cada

## Bake-off

| modelo | latência mediana (ms) | tok/s | args válidos | status |
|---|---|---|---|---|
| qwen3.5:27b | 1731 | 62.6 | 3/3 | — |
| gpt-oss:20b | 904 | 161.8 | 3/3 | — |
| gemma4:12b | 890 | 72.4 | 3/3 | — |
| qwen2.5-coder:14b | 424 | — | 0/3 | eliminado: Model response did not contain a tool call even though tool choice was required. |

**Vencedor:** gpt-oss:20b

## Corrida completa (orçamento 30)

| métrica | local:gpt-oss:20b | nuvem:claude-haiku-4-5 |
|---|---|---|
| resultado | done | budget |
| passos | 17 | 30 |
| tempo total (s) | 37 | 59 |
| s·GPU (gen_ms acumulado) | 33.9 | 56.3 |
| tokens in / out | 158585 / 5711 | 469962 / 3694 |
| cache read | 0 | 321552 |
| tool calls inválidas | 0 | 0 |
| degradou (passo) | não | não |
| encerrou cedo (passos sobrando) | 13 | 0 |
| custo | 33.9 s·GPU | US$ 0.1990 |
| pico de VRAM (MiB) | 16348 | — |
| bloqueio de plataforma | nenhum | nenhum |

## Resumo do agente — local

Nenhum comentário recente sem resposta foi detectado na sessão atual. No momento não há rascunhos a propor.

## Resumo do agente — Haiku


## Observações

- O gpt-oss:20b **não chamou `open_app`**: aproveitou o Instagram já em primeiro plano (deixado pelo bake-off/corrida anterior) e explorou por `find_nodes` repetidos e dois scrolls; dois erros de negócio do MCP (`scroll` com `amount` inválido, `scroll_to_node` com nó inexistente) não contam no piso, por desenho. Concluiu no passo 17 com a mesma resposta do Haiku ("nenhum comentário sem resposta" — a conta de teste não tem publicações), com menos navegação.
- O Haiku abriu o app, navegou para perfil/posts e rolou; o gate negou **4** tentativas de ação irreversível (passos 6, 14, 21, 22). O resumo do Haiku está vazio porque a corrida terminou por orçamento (`budget`), como no incremento 1.
- Critério do spec §8 atendido (0 inválidas, sem degradar, 37 s ≤ 3 × 59 s) → default de fábrica do worker passa a `local`/`gpt-oss:20b`. A qualidade da exploração (não só a validade das tool calls) fica como métrica a acompanhar quando houver uma conta com publicações e comentários reais.
