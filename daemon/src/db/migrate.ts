import type { DatabaseSync } from 'node:sqlite';

/** Colunas adicionadas depois do incremento 1. `alter table add column` não é idempotente no SQLite; checamos antes. */
const COLUMNS: readonly { table: string; column: string; ddl: string }[] = [
  { table: 'step', column: 'provider', ddl: 'text' },
  { table: 'step', column: 'gen_ms', ddl: 'integer' },
  { table: 'step', column: 'invalid_call', ddl: 'integer not null default 0' },
  { table: 'task', column: 'degraded', ddl: 'integer not null default 0' },
  { table: 'task', column: 'escalated_at_step', ddl: 'integer' },
];

export function applyMigrations(db: DatabaseSync): void {
  for (const m of COLUMNS) {
    const have = (db.prepare(`pragma table_info(${m.table})`).all() as { name: string }[]).some((c) => c.name === m.column);
    if (!have) db.exec(`alter table ${m.table} add column ${m.column} ${m.ddl}`);
  }
}
