export const schemaStatements = [
  `create table if not exists users (
    id uuid primary key,
    email text not null,
    full_name text not null,
    password_hash text not null,
    created_at timestamptz not null default now()
  )`,
  'create unique index if not exists users_email_unique_idx on users(lower(email))',
  `create table if not exists sessions (
    token_hash text primary key,
    user_id uuid not null references users(id) on delete cascade,
    expires_at timestamptz not null,
    created_at timestamptz not null default now()
  )`,
  "alter table sessions add column if not exists token_type text not null default 'browser'",
  'alter table sessions add column if not exists label text',
  'alter table sessions add column if not exists revoked_at timestamptz',
  `create table if not exists notifications (
    id uuid primary key,
    user_id uuid not null references users(id) on delete cascade,
    type text not null,
    title text not null,
    message text not null,
    severity text not null default 'info' check (severity in ('info', 'success', 'warning', 'error')),
    action_url text,
    metadata jsonb not null default '{}'::jsonb,
    read_at timestamptz,
    created_at timestamptz not null default now()
  )`,
  'alter table notifications add column if not exists dedupe_key text',
  `create table if not exists workspaces (
    id uuid primary key,
    name text not null,
    business_type text not null default 'general',
    created_at timestamptz not null default now()
  )`,
  'alter table workspaces add column if not exists owner_user_id uuid references users(id) on delete cascade',
  `create table if not exists datasets (
    id uuid primary key,
    workspace_id uuid not null references workspaces(id) on delete cascade,
    filename text not null,
    file_type text not null,
    row_count integer not null,
    column_count integer not null,
    columns jsonb not null,
    summary jsonb not null,
    created_at timestamptz not null default now()
  )`,
  'alter table datasets add column if not exists analytics jsonb',
  'alter table datasets add column if not exists source_hash text',
  'alter table datasets add column if not exists file_size_bytes integer',
  'alter table datasets add column if not exists display_name text',
  'alter table datasets add column if not exists archived_at timestamptz',
  `create table if not exists dataset_rows (
    dataset_id uuid not null references datasets(id) on delete cascade,
    row_index integer not null,
    payload jsonb not null,
    primary key (dataset_id, row_index)
  )`,
  `create table if not exists analyses (
    id uuid primary key,
    dataset_id uuid not null references datasets(id) on delete cascade,
    mission text not null,
    status text not null check (status in ('queued', 'running', 'completed', 'failed')),
    model text not null,
    briefing jsonb,
    error text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    completed_at timestamptz
  )`,
  'alter table analyses add column if not exists failure_code text',
  'alter table analyses add column if not exists failure_details jsonb',
  'alter table analyses add column if not exists retry_count integer not null default 0',
  'alter table analyses add column if not exists started_at timestamptz',
  'alter table analyses add column if not exists last_heartbeat_at timestamptz',
  'alter table analyses add column if not exists invalidated_at timestamptz',
  `create table if not exists analysis_datasets (
    analysis_id uuid not null references analyses(id) on delete cascade,
    dataset_id uuid not null references datasets(id) on delete cascade,
    position integer not null default 0,
    primary key (analysis_id, dataset_id)
  )`,
  `insert into analysis_datasets (analysis_id, dataset_id, position)
   select id, dataset_id, 0 from analyses on conflict do nothing`,
  `create table if not exists agent_runs (
    id uuid primary key,
    analysis_id uuid not null references analyses(id) on delete cascade,
    agent_key text not null,
    agent_name text not null,
    role text not null,
    sequence integer not null,
    status text not null check (status in ('queued', 'running', 'completed', 'failed')),
    input_summary text,
    output jsonb,
    openai_response_id text,
    started_at timestamptz,
    completed_at timestamptz,
    unique (analysis_id, agent_key)
  )`,
  `create table if not exists team_conversations (
    id uuid primary key,
    user_id uuid not null references users(id) on delete cascade,
    analysis_id uuid not null references analyses(id) on delete cascade,
    context_key text,
    title text not null,
    target_agent_key text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,
  'alter table team_conversations add column if not exists context_key text',
  `create table if not exists team_conversation_datasets (
    conversation_id uuid not null references team_conversations(id) on delete cascade,
    dataset_id uuid not null references datasets(id) on delete cascade,
    position integer not null default 0,
    primary key (conversation_id, dataset_id)
  )`,
  `insert into team_conversation_datasets (conversation_id, dataset_id, position)
   select c.id, ad.dataset_id, (row_number() over (partition by c.id order by ad.dataset_id))::integer - 1
   from team_conversations c join analysis_datasets ad on ad.analysis_id = c.analysis_id
   on conflict do nothing`,
  `update team_conversations c set context_key = source.context_key
   from (
     select conversation_id, string_agg(dataset_id::text, ',' order by dataset_id::text) as context_key
     from team_conversation_datasets group by conversation_id
   ) source
   where c.id = source.conversation_id and (c.context_key is null or c.context_key = '')`,
  'alter table team_conversations alter column context_key set not null',
  `create table if not exists team_messages (
    id uuid primary key,
    conversation_id uuid not null references team_conversations(id) on delete cascade,
    role text not null check (role in ('user', 'agent', 'synthesis')),
    agent_key text,
    content text not null,
    evidence text,
    confidence double precision,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists meeting_jobs (
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
  )`,
  'alter table team_messages add column if not exists job_id uuid references meeting_jobs(id) on delete set null',
  `create table if not exists meeting_job_events (
    id uuid primary key,
    job_id uuid not null references meeting_jobs(id) on delete cascade,
    event_type text not null,
    agent_key text,
    message_id uuid references team_messages(id) on delete set null,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists user_ai_preferences (
    user_id uuid primary key references users(id) on delete cascade,
    business_type text not null default 'General business',
    priority text not null default 'Business resilience',
    forecast_horizon text not null default '6 months',
    risk_tolerance text not null default 'moderate',
    personality text not null default 'executive',
    communication_style text not null default 'executive',
    custom_instructions text not null default '',
    updated_at timestamptz not null default now()
  )`,
  `create table if not exists dataset_notes (
    dataset_id uuid primary key references datasets(id) on delete cascade,
    user_id uuid not null references users(id) on delete cascade,
    note text not null default '',
    updated_at timestamptz not null default now()
  )`,
  `create table if not exists bookmarks (
    id uuid primary key,
    user_id uuid not null references users(id) on delete cascade,
    dataset_id uuid references datasets(id) on delete cascade,
    resource_type text not null,
    resource_id text not null,
    title text not null,
    action_url text not null,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    unique(user_id, resource_type, resource_id)
  )`,
  `create table if not exists decision_records (
    id uuid primary key,
    user_id uuid not null references users(id) on delete cascade,
    dataset_id uuid not null references datasets(id) on delete cascade,
    analysis_id uuid references analyses(id) on delete set null,
    kind text not null,
    title text not null,
    verdict text not null,
    risk text not null,
    confidence double precision,
    score double precision,
    proposal jsonb not null,
    result jsonb not null,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists share_links (
    id uuid primary key,
    user_id uuid not null references users(id) on delete cascade,
    token_hash text not null unique,
    report_type text not null,
    title text not null,
    snapshot jsonb not null,
    expires_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz not null default now()
  )`,
  'create index if not exists datasets_workspace_created_idx on datasets(workspace_id, created_at desc)',
  'create unique index if not exists datasets_workspace_source_hash_idx on datasets(workspace_id, source_hash) where source_hash is not null',
  'create index if not exists workspaces_owner_idx on workspaces(owner_user_id, created_at desc)',
  'create index if not exists sessions_user_expires_idx on sessions(user_id, expires_at)',
  'create index if not exists notifications_user_created_idx on notifications(user_id, created_at desc)',
  'create index if not exists notifications_unread_idx on notifications(user_id, created_at desc) where read_at is null',
  'create unique index if not exists notifications_user_dedupe_idx on notifications(user_id, dedupe_key) where dedupe_key is not null',
  'create index if not exists analyses_dataset_created_idx on analyses(dataset_id, created_at desc)',
  'create index if not exists analysis_datasets_dataset_idx on analysis_datasets(dataset_id, analysis_id)',
  'create index if not exists agent_runs_analysis_sequence_idx on agent_runs(analysis_id, sequence)',
  'create index if not exists team_conversations_user_updated_idx on team_conversations(user_id, updated_at desc)',
  'create index if not exists team_conversations_user_context_updated_idx on team_conversations(user_id, context_key, updated_at desc)',
  'create index if not exists team_conversation_datasets_dataset_idx on team_conversation_datasets(dataset_id, conversation_id)',
  'create index if not exists team_messages_conversation_created_idx on team_messages(conversation_id, created_at asc)',
  'create index if not exists meeting_jobs_conversation_created_idx on meeting_jobs(conversation_id, created_at desc)',
  "create unique index if not exists meeting_jobs_one_active_conversation_idx on meeting_jobs(conversation_id) where status in ('queued', 'preparing', 'running', 'synthesizing')",
  'create index if not exists meeting_jobs_status_updated_idx on meeting_jobs(status, updated_at)',
  'create index if not exists meeting_job_events_job_created_idx on meeting_job_events(job_id, created_at asc)',
  'create index if not exists dataset_notes_user_idx on dataset_notes(user_id, updated_at desc)',
  'create index if not exists bookmarks_user_created_idx on bookmarks(user_id, created_at desc)',
  'create index if not exists decisions_user_created_idx on decision_records(user_id, created_at desc)',
  'create index if not exists decisions_dataset_created_idx on decision_records(dataset_id, created_at desc)',
  'create index if not exists share_links_user_created_idx on share_links(user_id, created_at desc)',
]
