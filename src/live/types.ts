export interface LiveToolRow { readonly idx: number; readonly tool: string; readonly excerpt: string; readonly tokens: number; readonly gate: boolean; readonly provider?: string | null }
export interface LiveIdentity {
  readonly id: string; readonly name: string; readonly handle: string; readonly state: string; readonly task: string;
  readonly steps: number; readonly budget: number; readonly costUsd: number; readonly error: string; readonly lastTools: readonly LiveToolRow[];
  readonly degraded?: boolean; readonly genMs?: number; readonly earlyStopRemaining?: number;
  /** Estado do stream de vídeo no daemon ('idle' | 'starting' | 'streaming' | 'retrying'). */
  readonly video?: string;
}
export type LiveRoleKey = 'lider' | 'worker' | 'esc';
export interface LiveProviderTest { readonly role: LiveRoleKey; readonly model: string; readonly latencyMs: number; readonly tokensPerSec: number | null; readonly argsValid: boolean; readonly warning: string | null; readonly error: string | null; readonly at: string }
export interface LiveProvider { readonly role: LiveRoleKey; readonly mode: 'nuvem' | 'local'; readonly model: string; readonly endpoint: string; readonly lastTest: LiveProviderTest | null }
export interface FleetSnapshot { readonly identities: readonly LiveIdentity[]; readonly providers?: Readonly<Record<LiveRoleKey, LiveProvider>>; readonly killed: boolean; readonly updatedAt: string }
/** Poster (último screencap PNG, base64) de uma identidade; casado por id (spec inc. 4 §4.3). */
export interface LiveFrame { readonly id: string; readonly at: string; readonly png: string }
/** Access unit H.264 Annex B (base64); `key` traz SPS+PPS+IDR. */
export interface LiveVideoPacket { readonly id: string; readonly seq: number; readonly key: boolean; readonly nal: string }
export interface EnxameBridge {
  readonly onSnapshot: (cb: (s: FleetSnapshot) => void) => () => void;
  readonly onFrame: (cb: (f: LiveFrame) => void) => () => void;
  readonly onVideo: (cb: (p: LiveVideoPacket) => void) => () => void;
  readonly startGoal: (text: string) => Promise<void>;
  readonly kill: () => Promise<void>;
  readonly setProvider: (role: LiveRoleKey, patch: { mode?: 'nuvem' | 'local'; model?: string; endpoint?: string }) => Promise<void>;
  readonly testProvider: (role: LiveRoleKey) => Promise<LiveProviderTest>;
  readonly getProviderModels: (role: LiveRoleKey) => Promise<{ source: string; models: readonly string[]; error: string | null }>;
}
