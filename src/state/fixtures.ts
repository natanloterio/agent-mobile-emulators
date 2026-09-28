import type { GoalPlan, GoalSummary, HostMetrics, LiveIdentity } from '../live/types';

// Fixtures do contrato do incremento 5 (spec §3) para os testes do renderer.
export const liveId = (over: Partial<LiveIdentity> = {}): LiveIdentity => ({
  id: 'conta1', name: 'conta1', handle: '@conta.demo', state: 'running', task: 'Levantar comentários', steps: 7, budget: 30,
  costUsd: 0.12, error: '', lastTools: [], video: 'streaming',
  lifecycle: 'running', paused: false, controlled: false, ledgerCount: 4, lastStepTokens: 1432,
  appPackage: 'com.instagram.android', appVersionName: '448.0.0.52.84', consolePort: 5554, mcpHostPort: 8080,
  avdName: 'tapflock_conta1', serial: 'emulator-5554', snapshotTakenAt: null, restoreUnsafe: false,
  diskBytes: null, bannedReason: null, discardedAt: null, signals: null,
  ...over,
});

export const goalSummary = (over: Partial<GoalSummary> = {}): GoalSummary => ({
  id: 'g1', text: 'Responder comentários', pattern: 'fan-out', state: 'running', costUsd: 1.5,
  createdAt: '2026-09-26 10:00:00', finishedAt: null, tasksTotal: 4, tasksDone: 1, tasksFailed: 0, tasksNeeds: 1,
  tasksRunning: 2, itemsHandled: 17, ...over,
});

export const hostMetrics = (over: Partial<HostMetrics> = {}): HostMetrics => ({
  ramUsedGiB: 40.25, ramTotalGiB: 125.6, cpuPct: 37.4, threads: 32, vramUsedMiB: 20480, vramTotalMiB: 32768,
  at: '2026-09-26T10:00:00Z', ...over,
});

export const ALL_OK = { bootCompleted: true, accessibility: true, mcpInitialize: true, toolsPresent: true, versionMatch: true };

export const goalPlan = (over: Partial<GoalPlan> = {}): GoalPlan => ({
  text: 'Responder comentários', pattern: 'fan-out', rationale: 'Trabalho preso à conta.',
  tasks: [
    { identityId: 'conta1', name: 'conta1', handle: '@a', instruction: 'Responder a própria caixa', signals: ALL_OK, ready: true, readyLabel: 'pronto' },
    { identityId: 'conta2', name: 'conta2', handle: '@b', instruction: 'Responder a própria caixa', signals: { ...ALL_OK, versionMatch: false }, ready: false, readyLabel: 'versão mudou · fora' },
  ],
  estimate: { tasks: 1, outOfProbe: 1, stepBudget: 30, fleetReadyMs: 42_300 },
  leader: { model: 'claude-sonnet-5', costUsd: 0.013, error: null },
  ...over,
});
