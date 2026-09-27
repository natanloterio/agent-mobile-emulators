export interface LiveToolRow { readonly idx: number; readonly tool: string; readonly excerpt: string; readonly tokens: number; readonly gate: boolean; readonly provider?: string | null }
export interface LiveIdentity {
  readonly id: string; readonly name: string; readonly handle: string; readonly state: string; readonly task: string;
  readonly steps: number; readonly budget: number; readonly costUsd: number; readonly error: string; readonly lastTools: readonly LiveToolRow[];
  readonly degraded?: boolean; readonly genMs?: number; readonly earlyStopRemaining?: number;
  /** Estado do stream de vídeo no daemon ('idle' | 'starting' | 'streaming' | 'retrying'). */
  readonly video?: string;
  // Incremento 5 (spec §3.1). Opcionais: daemon antigo não os manda.
  readonly lifecycle?: string; readonly paused?: boolean; readonly controlled?: boolean;
  readonly ledgerCount?: number; readonly lastStepTokens?: number;
  readonly appPackage?: string; readonly appVersionName?: string; readonly consolePort?: number; readonly mcpHostPort?: number;
  readonly avdName?: string; readonly serial?: string; readonly snapshotTakenAt?: string | null; readonly restoreUnsafe?: boolean;
  readonly diskBytes?: number | null; readonly bannedReason?: string | null; readonly discardedAt?: string | null;
  readonly signals?: ProbeSignals | null;
  readonly hasPin?: boolean;
}
export interface ProbeSignals {
  readonly bootCompleted: boolean; readonly accessibility: boolean; readonly mcpInitialize: boolean;
  readonly toolsPresent: boolean; readonly versionMatch: boolean;
}
export type GoalPattern = 'fan-out' | 'sharding';
export interface GoalSummary {
  readonly id: string; readonly text: string; readonly pattern: string; readonly state: string; readonly costUsd: number;
  readonly createdAt: string; readonly finishedAt: string | null; readonly rationale?: string | null;
  readonly tasksTotal: number; readonly tasksDone: number; readonly tasksFailed: number; readonly tasksNeeds: number;
  readonly tasksRunning: number; readonly itemsHandled: number;
}
export interface HostMetrics {
  readonly ramUsedGiB: number; readonly ramTotalGiB: number; readonly cpuPct: number; readonly threads: number;
  readonly vramUsedMiB: number | null; readonly vramTotalMiB: number | null; readonly at: string;
}
export interface PlanTask {
  readonly identityId: string; readonly name: string; readonly handle: string; readonly instruction: string;
  readonly signals: ProbeSignals | null; readonly ready: boolean; readonly readyLabel: string;
}
export interface GoalPlan {
  readonly text: string; readonly pattern: GoalPattern; readonly rationale: string; readonly tasks: readonly PlanTask[];
  readonly estimate: { readonly tasks: number; readonly outOfProbe: number; readonly stepBudget: number; readonly fleetReadyMs: number };
  readonly leader: { readonly model: string; readonly costUsd: number; readonly error: string | null };
}
/** Coordenadas normalizadas 0–1 sobre a tela do device (spec inc. 5 §3.3). */
export type InputGesture =
  | { readonly kind: 'tap'; readonly x: number; readonly y: number }
  | { readonly kind: 'swipe'; readonly x: number; readonly y: number; readonly x2: number; readonly y2: number; readonly durationMs: number }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'key'; readonly key: 'back' | 'home' | 'recents' | 'enter' | 'del' };
export type LiveRoleKey = 'lider' | 'worker' | 'esc';
export interface LiveProviderTest { readonly role: LiveRoleKey; readonly model: string; readonly latencyMs: number; readonly tokensPerSec: number | null; readonly argsValid: boolean; readonly warning: string | null; readonly error: string | null; readonly at: string }
/** Runtime local de um papel (spec runtimes locais): ambos OpenAI-compatible. */
export type LocalRuntime = 'ollama' | 'lmstudio';
export interface LiveProvider {
  readonly role: LiveRoleKey; readonly mode: 'nuvem' | 'local'; readonly model: string; readonly endpoint: string; readonly lastTest: LiveProviderTest | null;
  /** `null` na nuvem; ausente em daemon antigo. */
  readonly runtime?: LocalRuntime | null;
}
/** Estado de um runtime local instalado (ou não) na máquina. */
export interface RuntimeInfo {
  readonly kind: LocalRuntime; readonly label: string; readonly endpoint: string;
  readonly installed: boolean; readonly running: boolean; readonly error: string | null;
}
/** Modelo já baixado num runtime; tamanho e estado carregado podem ser desconhecidos. */
export interface ModelEntry {
  readonly id: string; readonly runtime: LocalRuntime; readonly label: string;
  readonly sizeBytes: number | null; readonly loaded: boolean | null; readonly toolUse: boolean | null;
}
/** `GET /providers/models?role=X`; `runtimes`/`entries` só vêm de papel local em daemon novo. */
export interface ProviderModelsResponse {
  readonly source: string; readonly models: readonly string[]; readonly error: string | null;
  readonly runtimes?: readonly RuntimeInfo[]; readonly entries?: readonly ModelEntry[];
}
export interface ProviderPatch { readonly mode?: 'nuvem' | 'local'; readonly model?: string; readonly endpoint?: string; readonly runtime?: LocalRuntime }
export interface FleetSnapshot {
  readonly identities: readonly LiveIdentity[]; readonly providers?: Readonly<Record<LiveRoleKey, LiveProvider>>; readonly killed: boolean; readonly updatedAt: string;
  readonly goal?: GoalSummary | null; readonly host?: HostMetrics | null;
}
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
  readonly resume: () => Promise<void>;
  /** Canal genérico (spec inc. 5 §3.4): só rotas da lista de permissão do main. */
  readonly api: (method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) => Promise<unknown>;
  readonly setProvider: (role: LiveRoleKey, patch: ProviderPatch) => Promise<void>;
  readonly testProvider: (role: LiveRoleKey) => Promise<LiveProviderTest>;
  readonly getProviderModels: (role: LiveRoleKey) => Promise<ProviderModelsResponse>;
}
