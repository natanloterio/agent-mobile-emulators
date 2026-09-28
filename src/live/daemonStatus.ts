import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import type { DaemonStatus } from './types';

const DaemonStatusSchema = z.union([
  z.object({ state: z.enum(['starting', 'ok']) }),
  z.object({
    state: z.literal('failed'), reason: z.enum(['exited', 'timeout', 'stopped', 'other']),
    exitCode: z.number().nullable(), logPath: z.string().nullable(), detail: z.string(),
  }),
]);

/** Estado vindo do main; qualquer coisa fora do formato é ignorada (a tela fica como estava). */
export function parseDaemonStatus(raw: unknown): DaemonStatus | null {
  const r = DaemonStatusSchema.safeParse(raw);
  return r.success ? r.data : null;
}

export interface DaemonStatusView { readonly status: DaemonStatus | null; readonly retrying: boolean; readonly retry: () => void }

/** Assina o estado do daemon pelo preload. No navegador (modo demonstração) fica sempre `null`. */
export function useDaemonStatus(): DaemonStatusView {
  const [status, setStatus] = useState<DaemonStatus | null>(null);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    const bridge = window.tapflock?.daemon; if (!bridge) return;
    const apply = (raw: unknown) => { const s = parseDaemonStatus(raw); if (s) setStatus(s); };
    void bridge.status().then(apply, () => undefined);
    return bridge.onStatus(apply);
  }, []);
  const retry = useCallback(() => {
    const bridge = window.tapflock?.daemon; if (!bridge) return;
    setRetrying(true);
    void bridge.retry().finally(() => setRetrying(false));
  }, []);
  return { status, retrying, retry };
}
