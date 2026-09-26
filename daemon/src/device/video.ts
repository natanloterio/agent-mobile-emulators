import { createHash } from 'node:crypto';
import type { Duplex } from 'node:stream';
import { CONFIG } from '../config.js';
import type { Adb, ChildLike } from './adb.js';
import { createAccessUnitAssembler } from './h264.js';
import { connectTunnel } from './video-tunnel.js';

export interface VideoPacket { readonly id: string; readonly seq: number; readonly key: boolean; readonly data: Buffer }
export interface VideoTarget { readonly id: string; readonly serial: string }
export type VideoState = 'idle' | 'starting' | 'streaming' | 'retrying';
export interface VideoStreams {
  start(targets: readonly VideoTarget[]): void; stop(): void; setActive(active: boolean): void;
  onPacket(cb: (p: VideoPacket) => void): () => void; state(id: string): VideoState;
}
export interface VideoDeps {
  readonly adb: Pick<Adb, 'push' | 'forward' | 'forwardRemove' | 'shellSpawn'>;
  /** Default: `connectTunnel` (net.connect em 127.0.0.1, conectado = primeiro byte recebido). */
  readonly connect?: (port: number) => Promise<Duplex>;
  readonly sleep?: (ms: number) => Promise<void>; readonly serverPath?: string; readonly portFrom?: number;
  readonly connectTimeoutMs?: number; readonly retryMs?: number;
  readonly onState?: (id: string, state: VideoState) => void;
}

const S = CONFIG.scrcpy;

// scrcpy lê o scid com Integer.parseInt(s, 16): precisa caber em int32 com sinal, então zeramos o bit mais alto.
export const scidFor = (id: string): string =>
  ((parseInt(createHash('sha1').update(id).digest('hex').slice(0, 8), 16) & 0x7fffffff) >>> 0).toString(16).padStart(8, '0');

/** Linha de comando do servidor (spec inc. 4 §2): só vídeo, sem áudio/controle, H.264 Annex B puro. */
export function serverArgs(scid: string): readonly string[] {
  return [`CLASSPATH=${S.devicePath}`, 'app_process', '/', 'com.genymobile.scrcpy.Server', S.version,
    `scid=${scid}`, 'tunnel_forward=true', 'video=true', 'audio=false', 'control=false', 'raw_stream=true', 'cleanup=true',
    `max_size=${S.maxSize}`, `max_fps=${S.maxFps}`, `video_bit_rate=${S.bitRate}`,
    'video_codec_options=i-frame-interval:int=2', 'log_level=warn']; // quadro-chave a cada 2 s (KEY_I_FRAME_INTERVAL)
}

/** O `adb shell` padrão tem stdout/stderr em pipe: drena para o servidor nunca bloquear; stderr vai para o log. */
function drain(child: ChildLike, id: string): void {
  const c = child as { stdout?: NodeJS.ReadableStream; stderr?: NodeJS.ReadableStream };
  c.stdout?.resume();
  c.stderr?.on('data', (d: Buffer) => console.error(`[video ${id}] ${String(d).trim()}`));
}

/** Resolve quando o socket termina (fim, fechamento ou erro); o listener de erro fica para sempre (nunca derruba o daemon). */
const socketGone = (sock: Duplex): Promise<void> => new Promise((r) => {
  sock.on('error', () => r()); sock.once('end', () => r()); sock.once('close', () => r());
});
const childGone = (child: ChildLike): Promise<void> => new Promise((r) => { child.on('exit', () => r()); child.on('error', () => r()); });

export function createVideoStreams(deps: VideoDeps): VideoStreams {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const serverPath = deps.serverPath ?? S.serverPath; const portFrom = deps.portFrom ?? S.portFrom;
  const connectTimeoutMs = deps.connectTimeoutMs ?? S.connectTimeoutMs; const retryMs = deps.retryMs ?? S.retryMs;
  const connect = deps.connect ?? ((port: number) => connectTunnel(port, { timeoutMs: connectTimeoutMs, sleep }));
  const listeners = new Set<(p: VideoPacket) => void>();
  const states = new Map<string, VideoState>();
  /** Encerradores das sessões vivas: `setActive(false)`/`stop()` chamam todos. Síncronos (matam o processo na hora), pois o SIGINT sai logo em seguida. */
  const live = new Map<string, () => void>();
  /** Loops ociosos ou em espera de retry acordam quando `active` muda ou no `stop()`. */
  const wakers = new Set<() => void>();
  let active = false; let generation = 0;

  const setState = (id: string, s: VideoState) => { if (states.get(id) === s) return; states.set(id, s); deps.onState?.(id, s); };
  const wake = () => { const ws = [...wakers]; wakers.clear(); for (const w of ws) w(); };
  const waitWake = (ms?: number): Promise<void> => new Promise((r) => {
    wakers.add(r);
    if (ms !== undefined) void sleep(ms).then(() => { wakers.delete(r); r(); });
  });
  const endLive = () => { for (const end of [...live.values()]) end(); };
  const emit = (p: VideoPacket) => {
    for (const cb of listeners) { try { cb(p); } catch (e) { console.error('[video] listener falhou:', e); } }
  };

  /** Consome o stream H.264 até o socket/processo acabar ou a sessão ser encerrada de fora. */
  const pump = async (t: VideoTarget, sock: Duplex, child: ChildLike, ended: Promise<void>): Promise<void> => {
    const asm = createAccessUnitAssembler(); let seq = 0;
    sock.on('data', (d: Buffer) => {
      try {
        for (const au of asm.push(d)) { setState(t.id, 'streaming'); emit({ id: t.id, seq: seq++, key: au.key, data: au.data }); }
      } catch (e) { console.error(`[video ${t.id}] stream inválido:`, e); sock.destroy(); }
    });
    sock.resume();
    await Promise.race([socketGone(sock), childGone(child), ended]);
  };

  /** Uma sessão = forward + servidor + socket. Sempre desfaz o que subiu ao terminar. */
  const session = async (t: VideoTarget, port: number, gen: number): Promise<void> => {
    const scid = scidFor(t.id); let child: ChildLike | null = null; let sock: Duplex | null = null;
    let ender: (() => void) | null = null;
    try {
      setState(t.id, 'starting');
      // O scrcpy-server apaga o próprio jar ao iniciar: o push precisa acontecer a cada sessão (~2 ms).
      await deps.adb.push(t.serial, serverPath, S.devicePath);
      await deps.adb.forward(t.serial, port, `localabstract:scrcpy_${scid}`);
      const spawned = deps.adb.shellSpawn(t.serial, serverArgs(scid)); child = spawned; drain(spawned, t.id);
      let endSession = () => {};
      const ended = new Promise<void>((r) => { endSession = r; });
      ender = () => { sock?.destroy(); spawned.kill('SIGTERM'); endSession(); };
      live.set(t.id, ender);
      const connecting = connect(port);
      const connected = await Promise.race([connecting, childGone(spawned).then(() => null), ended.then(() => null)]);
      if (!connected) {
        void connecting.then((late) => late.destroy(), () => undefined); // conexão tardia não pode vazar
        if (gen !== generation || !active) return;
        throw new Error('scrcpy-server saiu antes de conectar');
      }
      sock = connected;
      if (gen !== generation || !active) return;
      await pump(t, sock, spawned, ended);
    } finally {
      if (ender && live.get(t.id) === ender) live.delete(t.id); // após start() a mesma id pode já ter sessão nova
      sock?.destroy(); child?.kill('SIGTERM');
      await deps.adb.forwardRemove(t.serial, port).catch(() => undefined);
    }
  };

  const loop = async (t: VideoTarget, port: number, gen: number): Promise<void> => {
    while (gen === generation) {
      if (!active) { setState(t.id, 'idle'); await waitWake(); continue; }
      try { await session(t, port, gen); } catch (e) { console.error(`[video ${t.id}] sessão falhou:`, e instanceof Error ? e.message : e); }
      if (gen !== generation) return;
      if (active) { setState(t.id, 'retrying'); await waitWake(retryMs); }
    }
  };

  return {
    start: (targets) => {
      generation += 1; endLive(); wake(); states.clear();
      targets.forEach((t, i) => { states.set(t.id, 'idle'); void loop(t, portFrom + i, generation); });
    },
    stop: () => { generation += 1; active = false; endLive(); wake(); },
    setActive: (a) => { if (a === active) return; active = a; if (!a) endLive(); wake(); },
    onPacket: (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    state: (id) => states.get(id) ?? 'idle',
  };
}
