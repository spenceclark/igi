-- IGI's own database (spec §11). Applied on every start; every statement is idempotent.
-- ponytail: one schema file, no migration tool; add numbered migrations once a deployed database holds data worth keeping.
-- Source documents, domain rows, snapshots and packs arrive with uploads and the pack (§6.2, §13).

create table if not exists review (
  id text primary key,
  period_end date not null,
  status text not null default 'open',
  source_dir text,                -- the scenario folder, until uploads replace it
  cairn_record jsonb,             -- the record, steps and slot ids returned by starting it (§6.1)
  created_at timestamptz not null default now()
);

create table if not exists analysis_run (
  id text primary key,
  review_id text not null references review,
  agent_definition_id text not null default 'investment-governance', -- constant (§8.6)
  started_at timestamptz not null,
  ended_at timestamptz,
  status text not null check (status in ('running', 'completed', 'completed_with_uncertainties', 'blocked', 'failed', 'budget_exhausted')),
  config jsonb not null,          -- model, effort, commit, versions and hashes, budget, sources, memory_enabled, knowledge_ids
  turns int not null default 0,
  tool_calls int not null default 0,
  usage jsonb,
  summary text
);

-- The visible trace (§8.5). Encrypted reasoning is never stored.
create table if not exists trace_event (
  run_id text not null references analysis_run on delete cascade,
  seq int not null,
  at timestamptz not null,
  type text not null,
  data jsonb not null,
  primary key (run_id, seq)
);

create table if not exists code_execution (
  run_id text not null references analysis_run on delete cascade,
  id text not null,
  purpose text not null,
  code text not null,
  ok boolean not null,
  result jsonb,
  stdout text not null,
  error text,
  error_type text,
  ms int not null,
  reads jsonb not null,
  primary key (run_id, id)
);

create table if not exists check_result (
  run_id text not null references analysis_run on delete cascade,
  id text not null,
  args jsonb not null,
  result jsonb not null,
  rows_used jsonb not null,
  primary key (run_id, id)
);

create table if not exists note (
  run_id text not null references analysis_run on delete cascade,
  id text not null,
  kind text not null,
  text text not null,
  related_ids jsonb,
  primary key (run_id, id)
);

-- One row per finding version (§6.7). Spark's findings are version 1; the operator puts a matter forward again as a new version.
create table if not exists finding (
  run_id text not null references analysis_run on delete cascade,
  id text not null,
  version int not null default 1,
  classification text not null,
  proposed_classification text not null,
  validation jsonb not null,
  content jsonb not null,         -- title, statement, materiality, portfolios, citations, numbers, explanation, assumptions, uncertainties
  superseded_by text,             -- a later finding in the same run that revises this one
  package_key text,               -- the investigation package file for this version and its hash (§10.3)
  package_sha256 text,
  withdrawn_at timestamptz,
  withdrawal_reason text,
  primary key (run_id, id, version),
  check ((withdrawn_at is null) = (withdrawal_reason is null))
);

-- The submission ledger (§12.4): the row is written before the request is sent.
create table if not exists cairn_submission (
  id uuid primary key default gen_random_uuid(),
  run_id text not null,
  finding_id text not null,
  finding_version int not null,
  kind text not null check (kind in ('assertion', 'file')),
  payload_sha256 text not null,
  source_reference text not null,
  proposed_step_id text,
  proposed_slot_id text,
  outcome text not null default 'sending' check (outcome in ('sending', 'submitted', 'refused', 'uncertain', 'abandoned')),
  candidate_id text,
  placement text,
  error_code text,
  cairn_status jsonb,
  cairn_read_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (run_id, finding_id, finding_version) references finding
);
