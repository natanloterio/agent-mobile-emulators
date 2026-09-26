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

export function pricingFor(row: ProviderRow): Pricing { return row.mode === 'nuvem' ? HAIKU_PRICING : LOCAL_PRICING; }
