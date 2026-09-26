const ROLES = new Set(['lider', 'worker', 'esc']);

/** O renderer manda `role` livre pelo IPC; só os três papéis viram path (spec inc. 3 §4.5). */
export function providerRoute(role: string, kind: 'put' | 'test' | 'models'): string {
  if (!ROLES.has(role)) throw new Error(`papel inválido: ${JSON.stringify(role)}`);
  if (kind === 'models') return `/providers/models?role=${role}`;
  return kind === 'test' ? `/providers/${role}/test` : `/providers/${role}`;
}
