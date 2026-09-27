import { randomInt } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { listMemory, memoryGet, memoryPut, type SubtaskReport } from '../db/missions.js';
import type { Vault } from '../vault/vault.js';

/** Troca valores de segredo por `•••` em qualquer texto que volte ao modelo ou vá para o banco. */
export interface SecretMask {
  add(value: string): void;
  mask(text: string): string;
}
const MASK = '•••';
const MIN_SECRET = 6; // valor curto demais casaria texto comum da tela

export function createSecretMask(initial: readonly string[] = []): SecretMask {
  const values = new Set<string>();
  const add = (v: string) => {
    if (v.length >= MIN_SECRET) values.add(v);
  };
  initial.forEach(add);
  return {
    add,
    mask: (text) => Array.from(values).reduce((t, v) => t.split(v).join(MASK), text),
  };
}

/**
 * Aplica a máscara de segredos no texto que volta ao modelo (e que o recordStep grava) de um resultado MCP (`run.ts`
 * usa isto para toda tool de missão). Partes que não são texto nem imagem (ex.: `resource`) são descartadas em vez
 * de mascaradas: não dá para garantir que todo texto aninhado nelas foi coberto, e um JSON cru vazando pro modelo é
 * pior que perder uma parte rara do resultado de uma tool.
 */
export function maskOut(out: unknown, mask: (s: string) => string): unknown {
  if (typeof out === 'string') return mask(out);
  if (out && typeof out === 'object' && Array.isArray((out as { content?: unknown }).content)) {
    const content = (out as { content: { type: string; text?: unknown }[] }).content
      .map((c) => (c.type === 'text' && typeof c.text === 'string' ? { ...c, text: mask(c.text) } : c))
      .filter((c) => c.type === 'text' || c.type === 'image');
    return { ...(out as object), content };
  }
  return out;
}

const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGIT = '23456789';
const SYMBOL = '!@#$%*_-';
const pick = (s: string) => s[randomInt(s.length)];

/** Senha de 20 caracteres com as quatro classes (provedores exigem); sem caracteres ambíguos. */
export function generatePassword(): string {
  const all = LOWER + UPPER + DIGIT + SYMBOL;
  const chars = [
    pick(LOWER),
    pick(UPPER),
    pick(DIGIT),
    pick(SYMBOL),
    ...Array.from({ length: 16 }, () => pick(all)),
  ];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export const secretEntryId = (missionId: string, key: string): string => `mission:${missionId}:${key}`;

export async function loadMissionSecrets(
  db: DatabaseSync,
  vault: Vault,
  missionId: string,
): Promise<readonly string[]> {
  const refs = listMemory(db, missionId).filter((m) => m.secret);
  const vals = await Promise.all(refs.map((m) => vault.get(m.value)));
  return vals.filter((v): v is string => typeof v === 'string');
}

export interface MissionRunCtx {
  readonly missionId: string;
  readonly vault: Vault;
  readonly mask: SecretMask;
}
export interface MissionToolCtx extends MissionRunCtx {
  readonly db: DatabaseSync;
  /** Digita no device sem passar pelo wrapper (não vira step). */
  readonly typeText: (nodeId: string, text: string) => Promise<void>;
  readonly onFinish: (r: SubtaskReport) => void;
  readonly onHuman: (reason: string) => void;
}

const KEY = z.string().regex(/^[A-Za-z0-9_.-]{1,80}$/, 'chave: letras, dígitos, ponto, _ e -, até 80');

/** Tools do executor em modo missão (spec missões §Executor). Nenhuma devolve valor de segredo. */
export function missionTools(ctx: MissionToolCtx): ToolSet {
  return {
    memory_put: tool({
      description:
        'Guarda um fato útil para as próximas subtarefas (ex.: email.address, email.inbox = "app Outlook"). Nunca guarde senha aqui: use secret_new.',
      inputSchema: z.object({ key: KEY, value: z.string().min(1).max(500) }),
      execute: async ({ key, value }) => {
        if (memoryGet(ctx.db, ctx.missionId, key)?.secret)
          throw new Error(`a chave ${key} é um segredo; não pode ser sobrescrita por memory_put`);
        memoryPut(ctx.db, ctx.missionId, key, ctx.mask.mask(value));
        return { saved: true };
      },
    }),
    secret_new: tool({
      description:
        'Gera uma senha forte guardada no cofre do daemon sob a chave dada (ex.: email.password, account.com.instagram.android.password). Você nunca vê a senha; digite-a com type_secret. Chamar de novo com a mesma chave não troca a senha.',
      inputSchema: z.object({ key: KEY }),
      execute: async ({ key }) => {
        if (memoryGet(ctx.db, ctx.missionId, key)?.secret) return { key, created: false };
        const value = generatePassword();
        const id = secretEntryId(ctx.missionId, key);
        await ctx.vault.put(id, value);
        memoryPut(ctx.db, ctx.missionId, key, id, true);
        ctx.mask.add(value);
        return { key, created: true };
      },
    }),
    type_secret: tool({
      description:
        'Digita no campo (node_id da última tela lida) o segredo guardado sob a chave. Use em todo campo de senha.',
      inputSchema: z.object({ node_id: z.string().min(1).max(40), key: KEY }),
      execute: async ({ node_id, key }) => {
        const ref = memoryGet(ctx.db, ctx.missionId, key);
        const value = ref?.secret ? await ctx.vault.get(ref.value) : null;
        if (!value) throw new Error(`segredo desconhecido: ${key} (crie com secret_new)`);
        ctx.mask.add(value);
        await ctx.typeText(node_id, value);
        return { typed: true, length: value.length };
      },
    }),
    request_human: tool({
      description:
        'Pare e peça um humano: captcha, "confirme que é você", código enviado por SMS/telefone, ou qualquer verificação que você não pode resolver. Explique em uma frase o que o humano precisa fazer.',
      inputSchema: z.object({ reason: z.string().min(3).max(300) }),
      execute: async ({ reason }) => {
        ctx.onHuman(ctx.mask.mask(reason));
        return { stopped: true };
      },
    }),
    finish_subtask: tool({
      description:
        'Encerre a subtarefa: ok=true se o critério de sucesso foi atingido. did = o que você fez (curto); blockers = o que atrapalhou ("" se nada).',
      inputSchema: z.object({ ok: z.boolean(), did: z.string().max(600), blockers: z.string().max(600) }),
      execute: async ({ ok, did, blockers }) => {
        ctx.onFinish({
          ok,
          did: ctx.mask.mask(did),
          blockers: ctx.mask.mask(blockers),
        });
        return { finished: true };
      },
    }),
  };
}
