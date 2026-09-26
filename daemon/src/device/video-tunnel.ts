import net from 'node:net';
import type { Duplex } from 'node:stream';

export interface TunnelDeps {
  readonly timeoutMs: number;
  readonly pollMs?: number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly dial?: (port: number) => Duplex;
}

const DEFAULT_POLL_MS = 100;
const defaultDial = (port: number): Duplex => net.connect(port, '127.0.0.1');

/**
 * Espera o primeiro byte do socket. `null` se ele fechar/errar antes disso ou se `waitMs` esgotar.
 * Em sucesso o byte volta para o buffer (`unshift`) e o socket fica pausado: quem consome chama `resume()`.
 */
function firstByte(sock: Duplex, waitMs: number): Promise<Duplex | null> {
  return new Promise((resolve) => {
    const finish = (result: Duplex | null) => {
      clearTimeout(timer);
      sock.off('data', onData); sock.off('end', onGone); sock.off('close', onGone); sock.off('error', onGone);
      if (!result) sock.destroy();
      resolve(result);
    };
    const onData = (chunk: Buffer) => { sock.pause(); sock.unshift(chunk); finish(sock); };
    const onGone = () => finish(null);
    const timer = setTimeout(onGone, Math.max(0, waitMs));
    sock.on('data', onData); sock.on('end', onGone); sock.on('close', onGone); sock.on('error', onGone);
  });
}

/**
 * Conecta no túnel `adb forward` do scrcpy-server. O adb aceita a conexão TCP mesmo antes de o servidor
 * no device escutar (e a fecha logo em seguida); com `raw_stream=true` não há byte dummy de confirmação,
 * então só consideramos conectado quando chega o primeiro byte do stream. Tenta de novo até `timeoutMs`.
 */
export async function connectTunnel(port: number, deps: TunnelDeps): Promise<Duplex> {
  const dial = deps.dial ?? defaultDial;
  const pollMs = deps.pollMs ?? DEFAULT_POLL_MS;
  const deadline = Date.now() + deps.timeoutMs;
  for (;;) {
    const sock = await firstByte(dial(port), deadline - Date.now());
    if (sock) return sock;
    if (Date.now() >= deadline) throw new Error(`scrcpy-server não enviou dados em ${deps.timeoutMs} ms (porta ${port})`);
    await deps.sleep(pollMs);
  }
}
