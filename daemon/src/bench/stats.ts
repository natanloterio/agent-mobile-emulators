export function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface BakeoffRow { readonly model: string; readonly latencyMs: number; readonly tokensPerSec: number | null; readonly argsValid: number; readonly runs: number; readonly eliminated: boolean; readonly reason: string | null }

/** Spec §8: argsValid em todas as rodadas é pré-requisito; desempate por tok/s. */
export function pickWinner(rows: readonly BakeoffRow[]): BakeoffRow | null {
  const ok = rows.filter((r) => !r.eliminated && r.argsValid === r.runs);
  return [...ok].sort((a, b) => (b.tokensPerSec ?? -1) - (a.tokensPerSec ?? -1))[0] ?? null;
}

const num = (n: number | null) => (n === null || Number.isNaN(n) ? '—' : String(Math.round(n * 10) / 10));

export function renderBakeoffTable(rows: readonly BakeoffRow[]): string {
  return ['| modelo | latência mediana (ms) | tok/s | args válidos | status |', '|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.model} | ${num(r.latencyMs)} | ${num(r.tokensPerSec)} | ${r.argsValid}/${r.runs} | ${r.eliminated ? `eliminado: ${r.reason}` : '—'} |`)].join('\n');
}

export interface RunSummary {
  readonly label: string; readonly outcome: string; readonly steps: number; readonly elapsedS: number; readonly genS: number;
  readonly inTok: number; readonly outTok: number; readonly cacheRead: number; readonly invalidCalls: number; readonly degraded: boolean;
  readonly escalatedAtStep: number | null; readonly earlyStopRemaining: number; readonly costUsd: number; readonly vramPeakMiB: number | null;
  readonly platformBlock: string | null; readonly summary: string;
}

export function renderComparison(a: RunSummary, b: RunSummary): string {
  const line = (k: string, f: (s: RunSummary) => string | number) => `| ${k} | ${f(a)} | ${f(b)} |`;
  return [`| métrica | ${a.label} | ${b.label} |`, '|---|---|---|',
    line('resultado', (s) => s.outcome), line('passos', (s) => s.steps), line('tempo total (s)', (s) => s.elapsedS), line('s·GPU (gen_ms acumulado)', (s) => s.genS),
    line('tokens in / out', (s) => `${s.inTok} / ${s.outTok}`), line('cache read', (s) => s.cacheRead), line('tool calls inválidas', (s) => s.invalidCalls),
    line('degradou (passo)', (s) => (s.degraded ? `sim (${s.escalatedAtStep})` : 'não')), line('encerrou cedo (passos sobrando)', (s) => s.earlyStopRemaining),
    line('custo', (s) => (s.costUsd > 0 ? `US$ ${s.costUsd.toFixed(4)}` : `${s.genS} s·GPU`)), line('pico de VRAM (MiB)', (s) => s.vramPeakMiB ?? '—'),
    line('bloqueio de plataforma', (s) => s.platformBlock ?? 'nenhum')].join('\n');
}

/** Review Focus 1: o benchmark só vale com o Ollama subido pelo daemon (contexto conhecido). */
export function assertDaemonOllama(tests: readonly { readonly warning: string | null }[]): void {
  const w = tests.find((t) => t.warning);
  if (w) throw new Error(`Ollama externo detectado (${w.warning}); o benchmark exige o processo subido pelo daemon (spec §12)`);
}
