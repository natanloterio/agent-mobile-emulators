import type { DatabaseSync } from 'node:sqlite';

/** Colunas adicionadas depois do incremento 1. `alter table add column` não é idempotente no SQLite; checamos antes. */
const COLUMNS: readonly { table: string; column: string; ddl: string }[] = [
  { table: 'step', column: 'provider', ddl: 'text' },
  { table: 'step', column: 'gen_ms', ddl: 'integer' },
  { table: 'step', column: 'invalid_call', ddl: 'integer not null default 0' },
  { table: 'task', column: 'degraded', ddl: 'integer not null default 0' },
  { table: 'task', column: 'escalated_at_step', ddl: 'integer' },
  { table: 'task', column: 'early_stop_remaining', ddl: 'integer' },
  // Incremento 5: identidade controlável pela tela e ciclo de vida real.
  { table: 'identity', column: 'paused', ddl: 'integer not null default 0' },
  { table: 'identity', column: 'controlled', ddl: 'integer not null default 0' },
  { table: 'identity', column: 'discarded_at', ddl: 'text' },
  { table: 'identity', column: 'last_signals_json', ddl: 'text' },
  { table: 'identity', column: 'disk_bytes', ddl: 'integer' },
  { table: 'identity', column: 'created_at', ddl: 'text' },
  { table: 'ledger', column: 'task_id', ddl: 'text' },
  { table: 'goal', column: 'finished_at', ddl: 'text' },
  { table: 'goal', column: 'plan_json', ddl: 'text' },
  { table: 'goal', column: 'rationale', ddl: 'text' },
  { table: 'identity', column: 'account_cleared_at', ddl: 'text' },
  // PIN do bloqueio de tela da identidade: o daemon destrava sozinho após boot/restore/tela apagada.
  { table: 'identity', column: 'lock_pin', ddl: 'text' },
  // Runtime local do papel (Ollama ou LM Studio); null na nuvem.
  { table: 'provider_config', column: 'runtime', ddl: 'text' },
  // Missões (spec missões): goal pattern='mission' com estado próprio; subtarefas são tasks numeradas.
  { table: 'goal', column: 'mission_state', ddl: 'text' },
  { table: 'goal', column: 'human_reason', ddl: 'text' },
  { table: 'goal', column: 'stalled', ddl: 'integer not null default 0' },
  { table: 'goal', column: 'identity_id', ddl: 'text' },
  { table: 'goal', column: 'lang', ddl: 'text' },
  { table: 'task', column: 'seq', ddl: 'integer' },
  { table: 'task', column: 'objective', ddl: 'text' },
  { table: 'task', column: 'success_criteria', ddl: 'text' },
  { table: 'task', column: 'report_json', ddl: 'text' },
  // Missões encadeadas (spec arquivos): espera a anterior terminar; handoff_label = arquivo que esta entrega à próxima.
  { table: 'goal', column: 'wait_for', ddl: 'text' },
  { table: 'goal', column: 'handoff_label', ddl: 'text' },
  // Quando a missão começou a rodar de fato (etapa de sequência: ao sair de waiting, não na criação da sequência).
  { table: 'goal', column: 'run_started_at', ddl: 'text' },
];

export function applyMigrations(db: DatabaseSync): void {
  for (const m of COLUMNS) {
    const have = (db.prepare(`pragma table_info(${m.table})`).all() as { name: string }[]).some((c) => c.name === m.column);
    if (!have) db.exec(`alter table ${m.table} add column ${m.column} ${m.ddl}`);
  }
}
