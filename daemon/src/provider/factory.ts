import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import { HAIKU_PRICING, type Pricing } from '../worker/record.js';
import type { ProviderRow } from './config.js';
import { ProviderError } from './errors.js';

export interface FactoryDeps { readonly fetch?: typeof fetch }

/** Local custa segundos de GPU, não dólares (spec §5); o custo em s vem de gen_ms. */
export const LOCAL_PRICING: Pricing = { inputPerM: 0, outputPerM: 0, cacheReadPerM: 0 };

export function buildModel(row: ProviderRow, env: { anthropicApiKey?: string }, deps: FactoryDeps = {}): LanguageModel {
  if (row.mode === 'local') {
    // structuredOutputs: o Ollama aceita response_format json_schema; sem isto o SDK descarta o schema e o líder recebe texto livre.
    return createOpenAICompatible({ name: 'ollama', baseURL: row.endpoint, includeUsage: true, supportsStructuredOutputs: true, fetch: deps.fetch })(row.model);
  }
  if (!env.anthropicApiKey) throw new ProviderError('auth', `papel ${row.role} está na nuvem e ANTHROPIC_API_KEY está ausente`);
  return createAnthropic({ apiKey: env.anthropicApiKey, fetch: deps.fetch })(row.model);
}

/** Opções que só fazem sentido no provider Anthropic; o openai-compatible as ignoraria, mas melhor não enviar. */
export function providerOptionsFor(row: ProviderRow): Record<string, Record<string, unknown>> {
  return row.mode === 'nuvem' ? { anthropic: { disableParallelToolUse: true, cacheControl: { type: 'ephemeral', ttl: '1h' } } } : {};
}

/**
 * Opções para chamadas de saída estruturada (planejador, líder). No LM Studio, modelos de raciocínio (Qwen 3.x) põem o
 * JSON inteiro em `reasoning_content` e deixam `content` vazio — o SDK não acha o objeto. `reasoning_effort: none`
 * faz o JSON voltar no `content` (medido com qwen/qwen3.6-27b, 2026-09-27). Ollama e nuvem: nada muda.
 */
export function structuredOutputOptions(row: ProviderRow): Record<string, Record<string, unknown>> | undefined {
  return row.mode === 'local' && row.runtime === 'lmstudio' ? { openaiCompatible: { reasoningEffort: 'none' } } : undefined;
}

/** US$ por milhão de tokens (tabela da API Anthropic, 2026-06); cache read = 0,1× o input. */
export const CLOUD_PRICING: Readonly<Record<string, Pricing>> = {
  'claude-haiku-4-5': HAIKU_PRICING,
  'claude-sonnet-5': { inputPerM: 2, outputPerM: 10, cacheReadPerM: 0.2 },
  'claude-opus-5': { inputPerM: 5, outputPerM: 25, cacheReadPerM: 0.5 },
};

/** Modelo de nuvem fora da tabela conta pelo mais caro conhecido: melhor superestimar do que esconder custo. */
export function pricingFor(row: ProviderRow): Pricing {
  if (row.mode !== 'nuvem') return LOCAL_PRICING;
  return CLOUD_PRICING[row.model] ?? CLOUD_PRICING['claude-opus-5'];
}
