export type DeviceState = 'running' | 'idle' | 'needs' | 'offline' | 'paused';

export type Lifecycle =
  | 'blank'
  | 'provisioned'
  | 'logged-in'
  | 'running'
  | 'dirty'
  | 'restored'
  | 'banned';

export type Screen = 'cockpit' | 'device' | 'new' | 'report' | 'ids' | 'prov';

export type RoleKey = 'lider' | 'worker' | 'esc';
export type ProviderMode = 'nuvem' | 'local';
export type TestStage = 'run' | 'done' | null;
export type PlanStage = 0 | 1 | 2;

export type VideoStreamState = 'idle' | 'starting' | 'streaming' | 'retrying';

/** Identidade ativa na frota: um AVD preso a uma conta. */
export interface Identity {
  readonly id?: string;
  readonly name: string;
  readonly handle: string;
  readonly state: DeviceState;
  readonly task: string;
  readonly steps: number;
  readonly budget: number;
  readonly cost: number;
  readonly error: string;
  readonly genMs?: number;
  readonly degraded?: boolean;
  readonly earlyStopRemaining?: number;
  readonly screen?: { readonly dataUrl: string; readonly at: string };
  /** Estado do stream de vídeo no daemon; 'streaming' = ao vivo mesmo com a tela parada. */
  readonly video?: VideoStreamState;
}

/** Identidade fora da frota ativa (banida, em provisionamento). */
export interface ExtraIdentity {
  readonly name: string;
  readonly handle: string;
  readonly lc: Lifecycle;
  readonly app: string;
  readonly version: string;
  readonly snap: string;
  readonly disk: string;
  readonly diskPct: number;
  readonly ports: string;
  readonly action: string;
}

export interface ToolStep {
  readonly tool: string;
  readonly desc: string;
}

export interface RoleDef {
  readonly key: RoleKey;
  readonly name: string;
  readonly volume: string;
  readonly tone: 'grey' | 'green' | 'dark';
}

export interface PastGoal {
  readonly text: string;
  readonly pattern: 'fan-out' | 'sharding';
  readonly result: string;
  readonly cost: string;
}
