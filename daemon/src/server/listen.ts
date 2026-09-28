import type { Server } from 'node:net';

export const DEFAULT_PORT = 47800;

export interface ListenOptions {
  /** Porta pedida explicitamente (TAPFLOCK_PORT): ocupada, falha em vez de trocar de porta. */
  readonly port?: number;
  readonly defaultPort?: number;
  /** Porta usada quando a padrão está ocupada; 0 = o sistema escolhe uma livre. */
  readonly fallbackPort?: number;
}

const bind = (server: Server, port: number) => new Promise<number>((resolve, reject) => {
  const onError = (e: Error) => { server.off('listening', onListening); reject(e); };
  const onListening = () => { server.off('error', onError); resolve((server.address() as { port: number }).port); };
  server.once('error', onError);
  server.once('listening', onListening);
  server.listen(port, '127.0.0.1');
});

/**
 * Escuta só em loopback. A porta padrão ocupada (daemon de outra versão ainda vivo, outro programa) não pode
 * derrubar o daemon: o app acha a porta real no daemon.json, então qualquer porta livre serve.
 */
export async function listenLoopback(server: Server, o: ListenOptions = {}): Promise<number> {
  if (o.port !== undefined) return bind(server, o.port);
  try {
    return await bind(server, o.defaultPort ?? DEFAULT_PORT);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e;
    return bind(server, o.fallbackPort ?? 0);
  }
}
