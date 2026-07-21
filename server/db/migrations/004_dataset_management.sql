alter table datasets add column if not exists display_name text;
alter table datasets add column if not exists archived_at timestamptz;
alter table analyses add column if not exists invalidated_at timestamptz;
