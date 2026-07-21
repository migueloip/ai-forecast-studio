alter table analyses add column if not exists failure_code text;
alter table analyses add column if not exists failure_details jsonb;
alter table analyses add column if not exists retry_count integer not null default 0;
alter table analyses add column if not exists started_at timestamptz;
alter table analyses add column if not exists last_heartbeat_at timestamptz;
