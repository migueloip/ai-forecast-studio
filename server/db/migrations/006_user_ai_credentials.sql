create table if not exists user_ai_credentials (
  user_id uuid primary key references users(id) on delete cascade,
  provider text not null check (provider in ('nvidia')),
  api_key_ciphertext text not null,
  api_key_iv text not null,
  api_key_auth_tag text not null,
  key_hint text not null,
  model text not null,
  base_url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
