-- Migração assistente (aplicada em 2026-10-03).
-- Exportada do histórico de migrações do Supabase.

set search_path = public, extensions;

create table if not exists conversation_turns (
  id          uuid primary key default gen_random_uuid(),
  role        text not null check (role in ('user','assistant')),
  content     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists conversation_turns_created_idx on conversation_turns (created_at desc);

alter table conversation_turns enable row level security;

create or replace function prune_conversation()
returns int language sql
set search_path = public, extensions
as $$
  with del as (delete from conversation_turns where created_at < now() - interval '30 days' returning 1)
  select count(*)::int from del;
$$;
revoke execute on function prune_conversation() from public, anon, authenticated;
grant  execute on function prune_conversation() to service_role;
