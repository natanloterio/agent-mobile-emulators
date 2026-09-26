import { describe, expect, it } from 'vitest';
import { assertDaemonOllama, median, pickWinner, renderBakeoffTable, renderComparison, type BakeoffRow, type RunSummary } from '../src/bench/stats.js';
import { startVramSampler } from '../src/bench/vram.js';

const row = (model: string, tps: number | null, argsValid: number, runs = 3): BakeoffRow => ({ model, latencyMs: 1000, tokensPerSec: tps, argsValid, runs, eliminated: argsValid < runs, reason: argsValid < runs ? 'args inválidos' : null });

describe('bench/stats', () => {
  it('median', () => { expect(median([3, 1, 2])).toBe(2); expect(median([4, 1, 3, 2])).toBe(2.5); expect(Number.isNaN(median([]))).toBe(true); });
  it('pickWinner exige args válidos em todas as rodadas e desempata por tok/s', () => {
    expect(pickWinner([row('a', 50, 2), row('b', 30, 3), row('c', 40, 3)])?.model).toBe('c');
    expect(pickWinner([row('a', 50, 2)])).toBeNull();
  });
  it('tabelas são markdown com uma linha por modelo/métrica', () => {
    const t = renderBakeoffTable([row('a', 50, 3), row('b', null, 1)]);
    expect(t).toMatch(/\| a \| 1000 \| 50 \| 3\/3 \| — \|/); expect(t).toMatch(/\| b \| 1000 \| — \| 1\/3 \| eliminado: args inválidos \|/);
    const s = (label: string): RunSummary => ({ label, outcome: 'done', steps: 30, elapsedS: 57, genS: 12.3, inTok: 1, outTok: 2, cacheRead: 3, invalidCalls: 0, degraded: false, escalatedAtStep: null, earlyStopRemaining: 0, costUsd: 0.21, vramPeakMiB: 21000, platformBlock: null, summary: 'ok' });
    const c = renderComparison(s('local'), s('haiku'));
    expect(c).toMatch(/\| passos \| 30 \| 30 \|/); expect(c).toMatch(/s·GPU/); expect(c).toMatch(/VRAM/);
  });
});

describe('bench/vram', () => {
  it('amostra nvidia-smi e devolve o pico ao parar', async () => {
    const outs = ['3500', '21000', '18000']; let i = 0;
    const s = startVramSampler(async () => outs[Math.min(i++, outs.length - 1)], 1);
    await new Promise((r) => setTimeout(r, 30));
    expect(s.stop()).toBe(21000);
  });
});

describe('bench — Review Focus 1 (Important 8)', () => {
  it('assertDaemonOllama recusa quando algum teste veio de Ollama externo (warning) e aceita quando não', () => {
    expect(() => assertDaemonOllama([{ warning: null }, { warning: 'contexto desconhecido (Ollama externo…)' }])).toThrow(/externo/);
    expect(() => assertDaemonOllama([{ warning: null }])).not.toThrow();
  });
});
