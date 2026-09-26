export const SCHEMA = `
create table if not exists identity (
  id text primary key, name text not null, handle text not null, avd_name text not null, serial text not null,
  console_port integer not null, mcp_host_port integer not null, mcp_token text not null, device_slug text not null,
  app_package text not null, app_version_name text not null, state text not null,
  lease_owner text, lease_expires_at text, snapshot_taken_at text, banned_reason text, banned_at text,
  last_error text, updated_at text not null default (datetime('now'))
);
create table if not exists goal (
  id text primary key, text text not null, pattern text not null, state text not null,
  created_at text not null default (datetime('now')), cost_usd real not null default 0
);
create table if not exists task (
  id text primary key, goal_id text not null references goal(id), identity_id text references identity(id),
  instruction text not null, state text not null, attempts integer not null default 0,
  cost_usd real not null default 0, created_at text not null default (datetime('now')), finished_at text
);
create table if not exists step (
  id integer primary key autoincrement, task_id text not null references task(id), idx integer not null,
  tool text, args_json text, result_excerpt text, input_tokens integer, output_tokens integer,
  cache_read_tokens integer, latency_ms integer, escalated integer not null default 0,
  idempotency_key text, intent_written_at text not null, started_at text, finished_at text, error text
);
create table if not exists ledger (
  identity_id text not null references identity(id), item_key text not null, kind text not null,
  note text, created_at text not null default (datetime('now')), primary key (identity_id, item_key)
);
create table if not exists decision_sample (
  id integer primary key autoincrement, step_id integer references step(id), reduced_state text not null,
  question text not null, model_answer text, label text, label_origin text check (label_origin in ('outcome','human','model'))
);
`;
