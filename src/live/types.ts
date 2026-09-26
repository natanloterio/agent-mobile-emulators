export interface LiveToolRow { readonly idx: number; readonly tool: string; readonly excerpt: string; readonly tokens: number; readonly gate: boolean; readonly provider?: string | null }
export interface LiveIdentity {
  readonly id: string; readonly name: string; readonly handle: string; readonly state: string; readonly task: string;
  readonly steps: number; readonly budget: number; readonly costUsd: number; readonly error: string; readonly lastTools: readonly LiveToolRow[];
  readonly degraded?: boolean; readonly genMs?: number; readonly earlyStopRemaining?: number;
}
export type LiveRoleKey = 'lider' | 'worker' | 'esc';
export interface LiveProviderTest { readonly role: LiveRoleKey; readonly model: string; readonly latencyMs: number; readonly tokensPerSec: number | null; readonly argsValid: boolean; readonly warning: string | null; readonly error: string | null; readonly at: string }
export interface LiveProvider { readonly role: LiveRoleKey; readonly mode: 'nuvem' | 'local'; readonly model: string; readonly endpoint: string; readonly lastTest: LiveProviderTest | null }
export interface FleetSnapshot { readonly identities: readonly LiveIdentity[]; readonly providers?: Readonly<Record<LiveRoleKey, LiveProvider>>; readonly killed: boolean; readonly updatedAt: string }
export interface EnxameBridge {
  readonly onSnapshot: (cb: (s: FleetSnapshot) => void) => () => void;
  readonly startGoal: (text: string) => Promise<void>;
  readonly kill: () => Promise<void>;
  readonly setProvider: (role: LiveRoleKey, patch: { mode?: 'nuvem' | 'local'; model?: string; endpoint?: string }) => Promise<void>;
  readonly testProvider: (role: LiveRoleKey) => Promise<LiveProviderTest>;
  readonly getProviderModels: (role: LiveRoleKey) => Promise<{ source: string; models: readonly string[]; error: string | null }>;
}
