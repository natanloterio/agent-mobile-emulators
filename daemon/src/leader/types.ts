import { z } from 'zod';

/** Contrato do plano (spec inc. 5 §3.3). O zod valida o plano que volta do cliente em `POST /goals`. */
export const PatternSchema = z.enum(['fan-out', 'sharding']);
export type Pattern = z.infer<typeof PatternSchema>;

export const ProbeSignalsSchema = z.object({
  bootCompleted: z.boolean(), accessibility: z.boolean(), mcpInitialize: z.boolean(), toolsPresent: z.boolean(), versionMatch: z.boolean(),
});

export const PlanTaskSchema = z.object({
  identityId: z.string().min(1).max(120), name: z.string().max(120), handle: z.string().max(120),
  instruction: z.string().min(1).max(4000), signals: ProbeSignalsSchema.nullable(),
  ready: z.boolean(), readyLabel: z.string().max(200),
});
export type PlanTask = z.infer<typeof PlanTaskSchema>;

export const GoalPlanSchema = z.object({
  text: z.string().min(3).max(2000), pattern: PatternSchema, rationale: z.string().max(2000),
  tasks: z.array(PlanTaskSchema).max(200),
  estimate: z.object({
    tasks: z.number().int().nonnegative(), outOfProbe: z.number().int().nonnegative(),
    stepBudget: z.number().int().nonnegative(), fleetReadyMs: z.number().nonnegative(),
  }),
  leader: z.object({ model: z.string().max(200), costUsd: z.number().nonnegative(), error: z.string().nullable() }),
});
export type GoalPlan = z.infer<typeof GoalPlanSchema>;
