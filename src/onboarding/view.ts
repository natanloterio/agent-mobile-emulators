import type { I18n } from '../i18n/translate';
import { LOCAL_MODELS, RAM_PER_EMULATOR_GIB, THREADS_PER_EMULATOR, VRAM_SYSTEM_GIB, type ModelEntry, type SetupMode } from './catalog';
import type { OnboardingState } from './reducer';
import { JOB_IDS, type DepId, type DepStatus, type Gpu, type Hardware, type JobEvent, type JobId, type SetupReport, type UserFix } from './schema';

export type RowId = DepId | 'model';
export interface DepRow { readonly id: RowId; readonly state: DepStatus['state']; readonly version: string | null; readonly sizeMb: number | null; readonly fix: UserFix | null }

const round1 = (n: number) => Math.round(n * 10) / 10;
export const needsLocal = (mode: SetupMode) => mode !== 'nuvem';
export const modelEntry = (id: string): ModelEntry | undefined => LOCAL_MODELS.find((m) => m.id === id);

/** Linhas do passo 1: as do main, sem Ollama no modo nuvem, com a linha do modelo escolhido logo depois do Ollama. */
export function depRows(report: SetupReport, mode: SetupMode, model: string): readonly DepRow[] {
  if (!needsLocal(mode)) return report.deps.filter((d) => d.id !== 'ollama');
  const installed = report.localModels.includes(model);
  const modelRow: DepRow = installed
    ? { id: 'model', state: 'ok', version: model, sizeMb: null, fix: null }
    : { id: 'model', state: 'todo', version: null, sizeMb: Math.round((modelEntry(model)?.sizeGb ?? 0) * 1000), fix: null };
  const i = report.deps.findIndex((d) => d.id === 'ollama');
  return [...report.deps.slice(0, i + 1), modelRow, ...report.deps.slice(i + 1)];
}

export interface Summary { readonly total: number; readonly ok: number; readonly todo: number; readonly user: number; readonly downloadMb: number }
export function summarize(rows: readonly DepRow[]): Summary {
  const count = (s: DepRow['state']) => rows.filter((r) => r.state === s).length;
  return { total: rows.length, ok: count('ok'), todo: count('todo'), user: count('user'), downloadMb: rows.reduce((a, r) => a + (r.state === 'todo' ? r.sizeMb ?? 0 : 0), 0) };
}

export function jobsToInstall(rows: readonly DepRow[]): readonly JobId[] {
  return rows.filter((r) => r.state === 'todo' && (JOB_IDS as readonly string[]).includes(r.id)).map((r) => r.id as JobId);
}
export function sizesOf(rows: readonly DepRow[]): Readonly<Partial<Record<JobId, number>>> {
  return Object.fromEntries(rows.filter((r) => r.state === 'todo').map((r) => [r.id, r.sizeMb ?? 0]));
}

export function emulatorCapacity(hw: Hardware): { count: number; limit: 'cpu' | 'ram' } {
  const byCpu = Math.floor(hw.threads / THREADS_PER_EMULATOR);
  const byRam = Math.floor(hw.ramGiB / RAM_PER_EMULATOR_GIB);
  return byCpu <= byRam ? { count: Math.max(0, byCpu), limit: 'cpu' } : { count: Math.max(0, byRam), limit: 'ram' };
}

export type ModelFit = 'fits' | 'tight' | 'too-big' | 'cpu';
export function modelFit(m: ModelEntry, gpu: Gpu): ModelFit {
  if (!gpu) return 'cpu';
  const need = m.vramGb + VRAM_SYSTEM_GIB;
  if (need > gpu.totalGiB) return 'too-big';
  return need > gpu.totalGiB * 0.9 ? 'tight' : 'fits';
}
export function defaultModel(gpu: Gpu): string {
  const fitting = LOCAL_MODELS.filter((m) => modelFit(m, gpu) !== 'too-big');
  const pick = fitting.find((m) => m.recommended) ?? [...fitting].sort((a, b) => b.vramGb - a.vramGb)[0];
  return (pick ?? LOCAL_MODELS[1]).id;
}
export const defaultMode = (gpu: Gpu): SetupMode => (gpu ? 'misto' : 'nuvem');

export interface VramBar { readonly systemPct: number; readonly modelPct: number; readonly freeGiB: number; readonly totalGiB: number }
export function vramBar(m: ModelEntry, gpu: Gpu): VramBar | null {
  if (!gpu) return null;
  const t = gpu.totalGiB;
  const model = Math.max(0, Math.min(m.vramGb, t - VRAM_SYSTEM_GIB));
  return { systemPct: (VRAM_SYSTEM_GIB / t) * 100, modelPct: (model / t) * 100, freeGiB: Math.max(0, round1(t - VRAM_SYSTEM_GIB - m.vramGb)), totalGiB: t };
}

export interface InstallTotals { readonly doneMb: number; readonly totalMb: number; readonly doneCount: number; readonly count: number; readonly failed: boolean; readonly allDone: boolean }
export function installTotals(jobs: readonly JobId[], events: Readonly<Partial<Record<JobId, JobEvent>>>, sizes: Readonly<Partial<Record<JobId, number>>>): InstallTotals {
  const list = jobs.map((id) => ({ id, ev: events[id], size: sizes[id] ?? 0 }));
  const doneCount = list.filter((j) => j.ev?.state === 'done').length;
  return {
    doneMb: list.reduce((a, j) => a + (j.ev?.doneMb ?? 0), 0),
    totalMb: list.reduce((a, j) => a + (j.ev?.totalMb || j.size), 0),
    doneCount, count: list.length,
    failed: list.some((j) => j.ev?.state === 'err'),
    allDone: doneCount === list.length,
  };
}

export function formatMb(mb: number, i18n: I18n): string {
  return mb >= 1000 ? `${i18n.fmt.decimal(mb / 1000)} GB` : `${Math.round(mb)} MB`;
}
const MB_PER_GIB = 1073.74;

/** Tira o "Error invoking remote method '…': Error: " que o Electron põe na frente. */
export function ipcErrorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '');
}

export interface FooterView { readonly action: string; readonly hint: string; readonly disabled: boolean; readonly showBack: boolean; readonly backDisabled: boolean }

export function footerView(s: OnboardingState, i18n: I18n): FooterView {
  const { t } = i18n;
  const base = { showBack: s.step > 0 && s.step < 3, backDisabled: s.step === 0 || s.installing || s.finishing };
  if (!s.report) {
    return { ...base, action: t('onboarding.nav.continue'), disabled: true, hint: s.checkError ? t('onboarding.check.failed', { error: s.checkError }) : t('onboarding.check.loading') };
  }
  const rows = depRows(s.report, s.mode, s.model);
  const sum = summarize(rows);
  const jobs = jobsToInstall(rows);
  if (s.step === 0) {
    if (sum.user > 0) return { ...base, action: t('onboarding.nav.continue'), disabled: true, hint: t('onboarding.hint.needsYou') };
    return { ...base, action: t('onboarding.nav.continue'), disabled: false, hint: jobs.length ? t('onboarding.hint.willInstall', { count: jobs.length }) : t('onboarding.hint.nothing') };
  }
  if (s.step === 1) {
    const entry = modelEntry(s.model);
    const tooBig = needsLocal(s.mode) && (!entry || modelFit(entry, s.report.hardware.gpu) === 'too-big');
    const size = formatMb(sum.downloadMb, i18n);
    const lowDisk = sum.downloadMb > s.report.hardware.diskFreeGiB * MB_PER_GIB;
    const hint = !jobs.length ? t('onboarding.hint.nothing')
      : lowDisk ? t('onboarding.hint.diskLow', { size, free: `${i18n.fmt.decimal(s.report.hardware.diskFreeGiB)} GB` })
      : t('onboarding.hint.download', { size });
    return { ...base, action: jobs.length ? t('onboarding.nav.install') : t('onboarding.nav.continue'), disabled: tooBig, hint };
  }
  if (s.step === 2) {
    if (s.finishing) return { ...base, action: t('onboarding.nav.finishing'), disabled: true, hint: '' };
    const totals = installTotals(jobs, s.jobs, sizesOf(rows));
    const cont = t('onboarding.nav.continue');
    if (s.finishError) return { ...base, action: cont, disabled: false, hint: t('onboarding.hint.finishFailed', { error: s.finishError }) };
    if (totals.failed || s.installError) return { ...base, action: cont, disabled: true, hint: t('onboarding.hint.error') };
    if (totals.allDone && !s.installing) return { ...base, action: cont, disabled: false, hint: t('onboarding.hint.done') };
    return { ...base, action: cont, disabled: true, hint: t('onboarding.hint.installing') };
  }
  return { ...base, action: t('onboarding.nav.finish'), disabled: false, hint: t('onboarding.hint.ready') };
}
