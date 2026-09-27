import { spawn, type ChildProcess } from 'node:child_process';
import { z } from 'zod';
import { SetupError, toSetupError } from './errors.js';

const BASE = 'http://127.0.0.1:11434';
const WAIT_TRIES = 80; // 80 × 250 ms = 20 s, igual ao supervisor do daemon

export interface PullDeps {
  readonly fetch: typeof fetch;
  readonly spawn: (cmd: string, args: readonly string[], opts: { env: NodeJS.ProcessEnv }) => ChildProcess;
  readonly sleep: (ms: number) => Promise<void>;
  readonly log: (line: string) => void;
}
interface Layer { readonly total: number; readonly completed: number }

export function pullProgress(layers: ReadonlyMap<string, Layer>): { done: number; total: number } {
  let done = 0; let total = 0;
  for (const l of layers.values()) { done += l.completed; total += l.total; }
  return { done, total };
}

export async function* ndjsonLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    const parts = buf.split('\n');
    buf = parts.pop() ?? '';
    for (const p of parts) if (p.trim()) yield p.trim();
  }
  if (buf.trim()) yield buf.trim();
}

const alive = (fetchFn: typeof fetch) => fetchFn(`${BASE}/api/version`).then((r) => r.ok, () => false);

/**
 * Usa o Ollama que já estiver no ar; senão sobe um `serve` só para o pull e derruba no fim. O daemon depois sobe o
 * dele com o contexto certo (daemon/src/provider/ollama.ts), então este não pode ficar vivo.
 */
async function withServer<T>(bin: string, d: PullDeps, fn: () => Promise<T>): Promise<T> {
  if (await alive(d.fetch)) return fn();
  const child = d.spawn(bin, ['serve'], { env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11434' } });
  let spawnErr: unknown = null;
  child.on('error', (e) => { spawnErr = e; });
  try {
    for (let i = 0; i < WAIT_TRIES; i++) {
      if (spawnErr) throw toSetupError(spawnErr);
      if (await alive(d.fetch)) return await fn();
      await d.sleep(250);
    }
    throw new SetupError('process', 'o Ollama não respondeu em 20 s');
  } finally {
    child.kill('SIGTERM');
  }
}

const PullLineSchema = z.object({
  status: z.string().optional(),
  digest: z.string().optional(),
  total: z.number().optional(),
  completed: z.number().optional(),
  error: z.string().optional(),
});
type PullLine = z.infer<typeof PullLineSchema>;

export async function pullModel(model: string, bin: string, d: PullDeps, progress: (doneMb: number, totalMb: number) => void): Promise<void> {
  await withServer(bin, d, async () => {
    let res: Response;
    try {
      res = await d.fetch(`${BASE}/api/pull`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, stream: true }) });
    } catch (e) { throw toSetupError(e); }
    if (!res.ok || !res.body) throw new SetupError('network', `o Ollama respondeu ${res.status} ao baixar ${model}`);
    let layers: ReadonlyMap<string, Layer> = new Map();
    for await (const line of ndjsonLines(res.body)) {
      let parsed: unknown;
      try { parsed = JSON.parse(line); } catch { continue; }
      const result = PullLineSchema.safeParse(parsed);
      if (!result.success) continue;
      const msg = result.data;
      if (msg.error) throw toSetupError(new Error(msg.error));
      if (msg.digest && typeof msg.total === 'number') {
        layers = new Map(layers).set(msg.digest, { total: msg.total, completed: msg.completed ?? 0 });
        const p = pullProgress(layers);
        progress(p.done / 1e6, p.total / 1e6);
      } else if (msg.status) {
        d.log(msg.status);
      }
    }
  });
}

export function nodePullDeps(log: (line: string) => void): PullDeps {
  return {
    fetch,
    spawn: (cmd, args, opts) => spawn(cmd, [...args], { env: opts.env, stdio: 'ignore' }),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log,
  };
}
