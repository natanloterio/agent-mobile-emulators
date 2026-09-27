import { describe, expect, it } from 'vitest';
import { clampLocalParallelInput, LOCAL_PARALLEL_MAX, LOCAL_PARALLEL_MIN, localParallelStateKind } from './localParallelField';

describe('clampLocalParallelInput', () => {
  it('inteiro dentro da faixa passa direto', () => {
    expect(clampLocalParallelInput('4', 1)).toBe(4);
  });
  it('fora da faixa é preso em 1..8', () => {
    expect(clampLocalParallelInput('0', 2)).toBe(LOCAL_PARALLEL_MIN);
    expect(clampLocalParallelInput('-3', 2)).toBe(LOCAL_PARALLEL_MIN);
    expect(clampLocalParallelInput('99', 2)).toBe(LOCAL_PARALLEL_MAX);
  });
  it('decimal arredonda; não numérico ou vazio mantém o valor anterior', () => {
    expect(clampLocalParallelInput('2.6', 1)).toBe(3);
    expect(clampLocalParallelInput('abc', 5)).toBe(5);
    expect(clampLocalParallelInput('', 5)).toBe(5);
  });
});

describe('localParallelStateKind', () => {
  it('pendente tem prioridade sobre o resto', () => {
    expect(localParallelStateKind({ pending: true, applied: { ollama: null, lmstudio: null } })).toBe('pending');
    expect(localParallelStateKind({ pending: true, applied: { ollama: 4, lmstudio: 4 } })).toBe('pending');
  });
  it('não pendente e Ollama externo/desconhecido (applied.ollama null): "external"', () => {
    expect(localParallelStateKind({ pending: false, applied: { ollama: null, lmstudio: 4 } })).toBe('external');
  });
  it('não pendente e Ollama nosso confirmado: "applied"', () => {
    expect(localParallelStateKind({ pending: false, applied: { ollama: 4, lmstudio: null } })).toBe('applied');
  });
});
