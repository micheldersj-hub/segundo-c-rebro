-- Migração conectores (aplicada em 2026-10-03).
-- Exportada do histórico de migrações do Supabase.

set search_path = public, extensions;

create table if not exists oauth_accounts (
  id                 uuid primary key default gen_random_uuid(),
  provider           text not null check (provider in ('google')),
  account_email      text not null,
  refresh_token_enc  text not null,
  access_token_enc   text,
  expires_at         timestamptz,
  scopes             text[] not null default '{}',
  sync_state         jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (provider, account_email)
);

alter table oauth_accounts enable row level security;
