import { z } from 'zod';
import { JOB_ORDER, type JobId } from './types.js';

/** Nome de modelo do Ollama: `nome` ou `nome:tag`, sem barra nem espaço (vira caminho de manifesto e corpo de /api/pull). */
const ModelName = z.string().max(120).regex(/^[a-z0-9][a-z0-9._-]*(?::[a-z0-9._-]+)?$/i, 'nome de modelo inválido');
export const AnthropicKeySchema = z.string().trim().min(20, 'chave curta demais').max(300, 'chave longa demais').startsWith('sk-ant-', 'a chave da Anthropic começa com sk-ant-');

export const InstallRequestSchema = z.object({
  jobs: z.array(z.enum(JOB_ORDER as [JobId, ...JobId[]])).max(JOB_ORDER.length),
  localModel: ModelName,
}).strict();
export type InstallRequest = z.infer<typeof InstallRequestSchema>;

export const FinishRequestSchema = z.object({
  mode: z.enum(['misto', 'local', 'nuvem']),
  localModel: ModelName,
  anthropicKey: AnthropicKeySchema.nullable(),
  /** false numa reabertura sem mexer em modo nem modelo: os papéis que a pessoa configurou em Provedores ficam como estão. */
  applyRoles: z.boolean(),
}).strict();
export type FinishRequest = z.infer<typeof FinishRequestSchema>;
