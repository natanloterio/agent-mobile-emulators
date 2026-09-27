import type { KeyTestResult } from './anthropic-key.js';
import { runJobs } from './jobs.js';
import type { SetupPaths } from './paths.js';
import type { ProbeResult } from './probe.js';
import { AnthropicKeySchema, FinishRequestSchema, InstallRequestSchema, type FinishRequest } from './requests.js';
import type { JobRunners } from './runners.js';

export interface SetupIpcDeps {
  readonly handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => void;
  readonly send: (channel: string, data: unknown) => void;
  readonly paths: SetupPaths;
  readonly status: () => Promise<{ completed: boolean; supported: boolean }>;
  readonly probe: () => Promise<ProbeResult>;
  readonly runners: (localModel: string, ollamaBin: string, log: (line: string) => void) => JobRunners;
  readonly testKey: (key: string) => Promise<KeyTestResult>;
  readonly finish: (req: FinishRequest, ollamaBin: string | null) => Promise<void>;
}

const UNSUPPORTED = 'plataforma sem suporte ao onboarding';

/** Canais do onboarding. Tudo que vem do renderer passa por zod antes de virar comando, caminho ou chamada de rede. */
export function registerSetupIpc(d: SetupIpcDeps): void {
  // O binário que o `finish` grava no setup.json: o achado na verificação, ou o nosso depois de instalar.
  let ollamaBin: string | null = null;
  let running: Promise<void> | null = null;
  // Fica true depois de um finish bem-sucedido; sem isso um reload da janela (Ctrl+R) veria o onboarding de
  // novo com o daemon já rodando, porque `d.status()` só reflete o que foi decidido na subida do main.
  let finished = false;

  d.handle('enxame:setup:status', async () => {
    const s = await d.status();
    return { completed: finished || s.completed, supported: s.supported };
  });
  d.handle('enxame:setup:check', async () => {
    const r = await d.probe();
    ollamaBin = r.ollamaBin;
    return r.report;
  });
  d.handle('enxame:setup:install', async (_e, raw) => {
    const req = InstallRequestSchema.parse(raw);
    if (!(await d.status()).supported) throw new Error(UNSUPPORTED);
    if (running) throw new Error('instalação já em andamento');
    const log = (line: string) => d.send('enxame:setup:log', line);
    const bin = req.jobs.includes('ollama') ? d.paths.ollamaBin : (ollamaBin ?? d.paths.ollamaBin);
    running = runJobs(req.jobs, d.runners(req.localModel, bin, log), (ev) => {
      if (ev.id === 'ollama' && ev.state === 'done') ollamaBin = d.paths.ollamaBin;
      d.send('enxame:setup:job', ev);
    });
    try { await running; } finally { running = null; }
  });
  d.handle('enxame:setup:testKey', async (_e, raw) => d.testKey(AnthropicKeySchema.parse(raw)));
  d.handle('enxame:setup:finish', async (_e, raw) => {
    const req = FinishRequestSchema.parse(raw);
    if (!(await d.status()).supported) throw new Error(UNSUPPORTED);
    if (running) throw new Error('instalação em andamento');
    await d.finish(req, ollamaBin);
    finished = true;
  });
}
