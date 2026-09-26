export interface LiveToolRow { readonly idx: number; readonly tool: string; readonly excerpt: string; readonly tokens: number; readonly gate: boolean }
export interface LiveIdentity {
  readonly id: string; readonly name: string; readonly handle: string; readonly state: string; readonly task: string;
  readonly steps: number; readonly budget: number; readonly costUsd: number; readonly error: string; readonly lastTools: readonly LiveToolRow[];
}
export interface FleetSnapshot { readonly identities: readonly LiveIdentity[]; readonly killed: boolean; readonly updatedAt: string }
export interface EnxameBridge {
  readonly onSnapshot: (cb: (s: FleetSnapshot) => void) => () => void;
  readonly startGoal: (text: string) => Promise<void>;
  readonly kill: () => Promise<void>;
}
