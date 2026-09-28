import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * App Android Remote Control MCP (MIT, github.com/danielealbano/android-remote-control-mcp), variante `gms-debug`: é o
 * pacote que o daemon espera (CONFIG.mcpAppPackage). Versão e sha256 fixos; trocar a versão exige trocar os dois.
 */
export const MCP_APK = {
  version: '1.12.0',
  url: 'https://github.com/danielealbano/android-remote-control-mcp/releases/download/v1.12.0/android-remote-control-mcp-v1.12.0-gms-debug.apk',
  sha256: '35d1e70f9de8cf061099038def28316f732c639bda6b8f25f98dfdc763f13228',
  bytes: 209_658_982,
} as const;

export interface ApkDeps {
  readonly fetch: (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; status: number; body: ReadableStream<Uint8Array> | null }>;
  /** Porcentagem inteira; só chamado quando ela muda (cada chamada vira gravação + snapshot na tela). */
  readonly onProgress?: (pct: number) => void;
  /** Sem nenhum byte por este tempo, o download é abortado (conexão travada não prende o preparo para sempre). */
  readonly idleMs?: number;
}

const IDLE_MS = 60_000;

export async function sha256File(file: string): Promise<string> {
  const h = createHash('sha256');
  await pipeline(createReadStream(file), h);
  return h.digest('hex');
}

/** Baixa (uma vez) e confere o APK; arquivo com hash errado nunca fica no lugar do certo. Devolve o caminho local. */
export async function ensureMcpApk(cacheDir: string, deps: ApkDeps, apk: { url: string; sha256: string; version: string; bytes: number } = MCP_APK): Promise<string> {
  mkdirSync(cacheDir, { recursive: true });
  const file = path.join(cacheDir, `android-remote-control-mcp-${apk.version}-gms-debug.apk`);
  if (existsSync(file) && (await sha256File(file)) === apk.sha256) return file;
  const part = `${file}.part`;
  rmSync(part, { force: true });
  const abort = new AbortController();
  let idle: NodeJS.Timeout | undefined;
  const kick = () => { clearTimeout(idle); idle = setTimeout(() => abort.abort(), deps.idleMs ?? IDLE_MS); };
  try {
    kick();
    const res = await deps.fetch(apk.url, { signal: abort.signal });
    if (!res.ok || !res.body) throw new Error(`download do app MCP falhou (HTTP ${res.status})`);
    let done = 0; let lastPct = -1;
    const counted = Readable.fromWeb(res.body as never).on('data', (c: Buffer) => {
      kick();
      done += c.length;
      const pct = Math.min(100, Math.floor((done / apk.bytes) * 100));
      if (pct !== lastPct) { lastPct = pct; deps.onProgress?.(pct); }
    });
    await pipeline(counted, createWriteStream(part));
  } catch (e) {
    rmSync(part, { force: true });
    if (abort.signal.aborted) throw new Error('o download do app MCP parou (sem dados por 1 min); tente de novo');
    throw e;
  } finally { clearTimeout(idle); }
  const got = await sha256File(part);
  if (got !== apk.sha256) { rmSync(part, { force: true }); throw new Error(`app MCP baixado não confere (sha256 ${got.slice(0, 12)}…)`); }
  renameSync(part, file);
  return file;
}
