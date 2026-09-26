import { describe, expect, it } from 'vitest';
import { SYSTEM_PROMPT, taskInstruction } from '../src/worker/prompt.js';

describe('taskInstruction', () => {
  it('objetivo de comentários mantém o roteiro de comentários', () => {
    const t = taskInstruction('Responder comentários das últimas 24 h');
    expect(t).toMatch(/Objetivo: Responder comentários/);
    expect(t).toMatch(/comment:<autor>/);
  });
  it('outro objetivo recebe roteiro genérico com item_key por tipo, sem falar de comentários', () => {
    const t = taskInstruction('Levantar DMs sem resposta');
    expect(t).toMatch(/Objetivo: Levantar DMs sem resposta/);
    expect(t).not.toMatch(/comentário/i);
    expect(t).toMatch(/item_key/);
    expect(t).toMatch(/Não envie nada/);
  });
  it('o system prompt fala de itens, não só de comentários', () => {
    expect(SYSTEM_PROMPT).toMatch(/Antes de tratar um item/);
  });
});
