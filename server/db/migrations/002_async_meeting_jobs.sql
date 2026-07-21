create table if not exists meeting_jobs (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  conversation_id uuid not null references team_conversations(id) on delete cascade,
  analysis_id uuid not null references analyses(id) on delete cascade,
  question_message_id uuid references team_messages(id) on delete set null,
  target_agent_key text not null,
  expected_agents text[] not null,
  completed_agents text[] not null default '{}'::text[],
  status text not null check (status in ('queued', 'preparing', 'running', 'synthesizing', 'completed', 'failed', 'cancelled', 'timed_out')),
  stage text not null default 'queued',
  attempt integer not null default 0,
  error_code text,
  error_message text,
  technical_details jsonb,
  cancel_requested_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table team_messages add column if not exists job_id uuid references meeting_jobs(id) on delete set null;

create table if not exists meeting_job_events (
  id uuid primary key,
  job_id uuid not null references meeting_jobs(id) on delete cascade,
  event_type text not null,
  agent_key text,
  message_id uuid references team_messages(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists meeting_jobs_conversation_created_idx on meeting_jobs(conversation_id, created_at desc);
create unique index if not exists meeting_jobs_one_active_conversation_idx on meeting_jobs(conversation_id)
where status in ('queued', 'preparing', 'running', 'synthesizing');
create index if not exists meeting_jobs_status_updated_idx on meeting_jobs(status, updated_at);
create index if not exists meeting_job_events_job_created_idx on meeting_job_events(job_id, created_at asc);
