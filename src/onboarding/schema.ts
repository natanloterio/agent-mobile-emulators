import { z } from 'zod';

/** Mesmo formato de electron/setup/types.ts; o renderer valida o que chega do main. */
export const DEP_IDS = ['node', 'sdk', 'adb', 'emu', 'img', 'kvm', 'ollama', 'keyring'] as const;
export const JOB_IDS = ['sdk', 'adb', 'emu', 'img', 'ollama', 'model'] as const;
const ERROR_KINDS = ['disk-full', 'network', 'checksum', 'process'] as const;

export const DepStatusSchema = z.object({
  id: z.enum(DEP_IDS), state: z.enum(['ok', 'todo', 'user']), version: z.string().nullable(), sizeMb: z.number().nullable(),
  fix: z.enum(['node-missing', 'kvm-group', 'kvm-bios', 'keyring-locked']).nullable(),
});
export const HardwareSchema = z.object({
  ramGiB: z.number(), threads: z.number().int(), cpuModel: z.string(),
  gpu: z.object({ name: z.string(), totalGiB: z.number() }).nullable(), diskFreeGiB: z.number(),
});
export const SetupReportSchema = z.object({ deps: z.array(DepStatusSchema), hardware: HardwareSchema, localModels: z.array(z.string()) });
export const JobEventSchema = z.object({
  id: z.enum(JOB_IDS), state: z.enum(['wait', 'run', 'done', 'err']), doneMb: z.number(), totalMb: z.number(),
  error: z.object({ kind: z.enum(ERROR_KINDS), message: z.string() }).nullable(),
});
export const SetupStatusSchema = z.object({ completed: z.boolean(), supported: z.boolean() });
export const KeyTestSchema = z.object({ result: z.enum(['ok', 'invalid', 'network']) });

export type DepStatus = z.infer<typeof DepStatusSchema>;
export type DepId = DepStatus['id'];
export type UserFix = NonNullable<DepStatus['fix']>;
export type Hardware = z.infer<typeof HardwareSchema>;
export type Gpu = Hardware['gpu'];
export type SetupReport = z.infer<typeof SetupReportSchema>;
export type JobEvent = z.infer<typeof JobEventSchema>;
export type JobId = JobEvent['id'];
export type KeyTestResult = z.infer<typeof KeyTestSchema>['result'];
