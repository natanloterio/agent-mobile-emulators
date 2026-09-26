import { DatabaseSync } from 'node:sqlite';
import { SCHEMA } from './schema.js';

export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('pragma journal_mode = wal; pragma foreign_keys = on;');
  db.exec(SCHEMA);
  return db;
}
