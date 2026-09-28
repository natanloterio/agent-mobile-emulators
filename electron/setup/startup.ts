import type { SetupPaths } from './paths.js';
import type { ProbeResult } from './probe.js';
import type { SetupFileT } from './setup-file.js';

/**
 * Onboarding aparece só em Linux x86_64 sem setup.json concluído. Quem já usava o Tapflock antes dele existir (tudo
 * `ok`) não vê nada: gravamos o setup.json concluído com os caminhos achados e o app sobe como antes. O Ollama é
 * opcional (só nuvem funciona), então a falta dele sozinha não obriga ninguém a passar pelo onboarding.
 */
export async function decideStartup(o: {
  readonly supported: boolean; readonly saved: SetupFileT | null; readonly paths: SetupPaths;
  readonly probe: () => Promise<ProbeResult>; readonly now: () => string;
}): Promise<{ completed: boolean; write: SetupFileT | null }> {
  if (!o.supported || o.saved?.completedAt) return { completed: true, write: null };
  const r = await o.probe().catch(() => null);
  if (!r || r.report.deps.some((d) => d.id !== 'ollama' && d.state !== 'ok')) return { completed: false, write: null };
  return { completed: true, write: { version: 1, completedAt: o.now(), paths: { sdkRoot: o.paths.sdkRoot, ollamaBin: r.ollamaBin } } };
}
