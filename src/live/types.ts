export interface LiveToolRow { readonly idx: number; readonly tool: string; readonly excerpt: string; readonly tokens: number; readonly gate: boolean; readonly provider?: string | null }
export interface LiveIdentity {
  readonly id: string; readonly name: string; readonly handle: string; readonly state: string; readonly task: string;
  readonly steps: number; readonly budget: number | null; readonly costUsd: number; readonly error: string; readonly lastTools: readonly LiveToolRow[];
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
  /** Emulador subindo agora (boot em segundo plano); ausente em daemon antigo. */
  readonly booting?: boolean;
  /** Emulador no adb agora; ausente em daemon antigo. */
  readonly online?: boolean;
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
export interface GpuSlice {
  readonly kind: 'model' | 'emulators' | 'other';
  readonly label: string; readonly usedMiB: number;
  readonly runtime?: 'ollama' | 'lmstudio';
}
export interface GpuBreakdown { readonly totalMiB: number; readonly usedMiB: number; readonly slices: readonly GpuSlice[]; readonly at: string }
export interface HostMetrics {
  readonly ramUsedGiB: number; readonly ramTotalGiB: number; readonly cpuPct: number; readonly threads: number;
  readonly vramUsedMiB: number | null; readonly vramTotalMiB: number | null; readonly at: string;
  /** SO/arquitetura do host (`process.platform`/`process.arch`); ausente num daemon antigo = Linux. */
  readonly platform?: string; readonly arch?: string;
  /** Ocupação real da GPU por consumidor; ausente/null = sem medida (a tela cai na estimativa do design). */
  readonly gpu?: GpuBreakdown | null;
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
/** Estado de uma missão (spec missões): aberta enquanto `running`/`awaiting-human`/`paused`/`waiting` (etapa esperando a anterior). */
export type MissionState = 'running' | 'awaiting-human' | 'paused' | 'done' | 'abandoned' | 'waiting';
export interface MissionSubtaskView {
  readonly seq: number; readonly objective: string; readonly state: string;
  readonly report: { readonly ok: boolean; readonly did: string; readonly blockers: string } | null;
  readonly costUsd: number;
}
/** Instrução do operador (spec instruções): `readSeq` nulo = ainda não lida (selo "aguardando"). */
export interface MissionNoteView { readonly id: number; readonly text: string; readonly createdAt: string; readonly readSeq: number | null }
export interface MissionView {
  readonly id: string; readonly identityId: string; readonly text: string; readonly state: MissionState; readonly humanReason: string | null;
  readonly stalled: boolean; readonly costUsd: number; readonly startedAt: string; readonly finishedAt: string | null;
  readonly current: { readonly seq: number; readonly objective: string } | null;
  readonly subtasks: readonly MissionSubtaskView[];
  readonly memory: readonly { readonly key: string; readonly value: string | null; readonly secret: boolean }[];
  readonly notes: readonly MissionNoteView[];
  /** Sequência (spec arquivos): missão anterior que esta espera e label do arquivo que esta entrega. Ausentes em daemon antigo. */
  readonly waitFor?: string | null; readonly handoffLabel?: string | null;
}
/** Arquivo guardado no host para passar entre aparelhos (spec arquivos). */
export interface FleetFileView {
  readonly id: string; readonly label: string; readonly name: string; readonly mime: string; readonly sizeBytes: number;
  readonly sourceIdentityId: string | null; readonly sourceMissionId: string | null; readonly createdAt: string;
}
/** Arquivo nas pastas compartilhadas de um device (`GET /files/device/:id`); `mtime` em segundos. */
export interface DeviceFileView { readonly path: string; readonly name: string; readonly size: number; readonly mtime: number }
/** Limites de passos configuráveis na tela (spec limites §UI); ausente em daemon antigo. */
export interface StepBudgets { readonly goal: number | null; readonly mission: number | null }
/** Paralelismo local configurável na tela (spec paralelismo §UI); ausente em daemon antigo. */
export interface LocalParallelStatus {
  readonly wanted: number;
  readonly applied: { readonly ollama: number | null; readonly lmstudio: number | null };
  readonly pending: boolean;
}
export interface FleetSnapshot {
  readonly identities: readonly LiveIdentity[]; readonly providers?: Readonly<Record<LiveRoleKey, LiveProvider>>; readonly killed: boolean; readonly updatedAt: string;
  readonly goal?: GoalSummary | null; readonly host?: HostMetrics | null;
  readonly missions?: readonly MissionView[];
  /** Arquivos guardados (spec arquivos); ausente em daemon antigo. */
  readonly files?: readonly FleetFileView[];
  readonly stepBudgets?: StepBudgets;
  readonly localParallel?: LocalParallelStatus;
  /** AVD-base do provisionamento; ausente em daemon antigo. */
  readonly baseAvd?: BaseAvdStatus | null;
}
/** `running` e `prep` ausentes em daemon de versão anterior. */
export interface BaseAvdStatus { readonly name: string; readonly found: boolean; readonly running?: boolean; readonly prep?: BasePrep }
export type BasePhase = 'avd' | 'boot' | 'mcp' | 'google' | 'app' | 'finish';
/** Espelha daemon/src/db/base-settings.ts: andamento do preparo automático do celular-base. */
export interface BasePrep {
  readonly state: 'idle' | 'running' | 'needs-google' | 'needs-human' | 'failed' | 'done'; readonly phase: BasePhase | null;
  readonly error: string | null; readonly missionId: string | null; readonly humanReason: string | null; readonly progress: number | null;
}
/** Poster (último screencap PNG, base64) de uma identidade; casado por id (spec inc. 4 §4.3). */
export interface LiveFrame { readonly id: string; readonly at: string; readonly png: string }
/** Access unit H.264 Annex B (base64); `key` traz SPS+PPS+IDR. */
export interface LiveVideoPacket { readonly id: string; readonly seq: number; readonly key: boolean; readonly nal: string }
export interface TapflockBridge {
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
  /** Cofre de credenciais no main (spec login determinístico); ausente em preload antigo. */
  readonly credentials?: CredentialsBridge;
  /** Login feito pelo daemon com a senha que o main decifra; o renderer nunca a relê. */
  readonly login?: (id: string) => Promise<LoginResult>;
  /** Onboarding de primeira execução; ausente em preload antigo e no navegador. */
  readonly setup?: SetupBridge;
  /** Conta Google do preparo do celular-base; ausente em preload antigo e no navegador. */
  readonly base?: BaseBridge;
  /** Chave da Anthropic depois do onboarding; ausente em preload antigo e no navegador. */
  readonly anthropicKey?: AnthropicKeyBridge;
  /** Subida do daemon (estado e nova tentativa); ausente em preload antigo e no navegador. */
  readonly daemon?: DaemonBridge;
}
/** Espelha DaemonStatus de electron/daemon-wait.ts; chega como `unknown` e é validado em src/live/daemonStatus.ts. */
export type DaemonStatus =
  | { readonly state: 'starting' | 'ok' }
  | { readonly state: 'failed'; readonly reason: 'exited' | 'timeout' | 'stopped' | 'other'; readonly exitCode: number | null; readonly logPath: string | null; readonly detail: string };
export interface BaseBridge { readonly google: (email: string, password: string) => Promise<void> }
export interface AnthropicKeyBridge {
  readonly status: () => Promise<unknown>;
  readonly set: (key: string) => Promise<void>;
}
export interface DaemonBridge {
  readonly status: () => Promise<unknown>;
  readonly retry: () => Promise<boolean>;
  readonly onStatus: (cb: (s: unknown) => void) => () => void;
}
export interface CredentialsAvailability { readonly ok: boolean; readonly reason: string | null }
/** Por id de identidade; nunca a senha. */
export type CredentialsStatus = Readonly<Record<string, { readonly username: string }>>;
export interface CredentialsBridge {
  readonly available: () => Promise<CredentialsAvailability>;
  readonly status: () => Promise<CredentialsStatus>;
  readonly set: (id: string, username: string, password: string) => Promise<void>;
  readonly clear: (id: string) => Promise<void>;
}
export type LoginOutcome = 'logged-in' | 'already-logged-in' | 'needs-human';
export interface LoginResult { readonly outcome: LoginOutcome; readonly detail: string }
/** Onboarding (spec onboarding): tudo chega como `unknown` e é validado em src/onboarding/schema.ts. */
export interface SetupBridge {
  readonly status: () => Promise<unknown>;
  readonly check: () => Promise<unknown>;
  readonly install: (req: { readonly jobs: readonly string[]; readonly localModel: string }) => Promise<void>;
  readonly onJob: (cb: (e: unknown) => void) => () => void;
  readonly onLog: (cb: (line: string) => void) => () => void;
  readonly testKey: (key: string) => Promise<unknown>;
  readonly finish: (req: { readonly mode: string; readonly localModel: string; readonly anthropicKey: string | null; readonly applyRoles: boolean }) => Promise<void>;
}
