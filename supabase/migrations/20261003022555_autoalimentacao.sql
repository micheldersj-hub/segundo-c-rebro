-- Migração autoalimentacao (aplicada em 2026-10-03).
-- Exportada do histórico de migrações do Supabase.

set search_path = public, extensions;

alter table facts add column if not exists superseded_by uuid references facts(id) on delete set null;
create index if not exists facts_superseded_idx on facts (superseded_by);

create table if not exists pending_questions (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('fact_conflict','confirmacao')),
  question    text not null,
  payload     jsonb not null default '{}'::jsonb,
  status      text not null default 'aberta' check (status in ('aberta','respondida','expirada')),
  answer      text,
  created_at  timestamptz not null default now(),
  answered_at timestamptz
);
create index if not exists pending_questions_open_idx on pending_questions (status, created_at);

create table if not exists feedback (
  id           uuid primary key default gen_random_uuid(),
  target_table text not null check (target_table in ('facts','episodes','patterns','skills','goals','reflections')),
  target_id    uuid,
  verdict      text not null check (verdict in ('certo','errado','corrigido','esquecer')),
  correction   text,
  created_at   timestamptz not null default now()
);
create index if not exists feedback_target_idx on feedback (target_table, target_id);

create table if not exists reflections (
  id           uuid primary key default gen_random_uuid(),
  period       text not null check (period in ('dia','semana','mes','plano_manha')),
  period_start date not null,
  content      text not null,
  data         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  unique (period, period_start)
);

create or replace function archive_stale_facts()
returns int language sql
set search_path = public, extensions
as $$
  with arch as (
    update facts set status = 'arquivado', updated_at = now()
     where status = 'ativo'
       and confidence < 0.3
       and updated_at < now() - interval '90 days'
    returning 1
  ) select count(*)::int from arch;
$$;

create or replace function purge_forgotten()
returns int language sql
set search_path = public, extensions
as $$
  with del as (
    delete from facts
     where status = 'rejeitado'
       and id in (select target_id from feedback
                   where target_table = 'facts' and verdict = 'esquecer'
                     and created_at < now() - interval '7 days')
    returning 1
  ) select count(*)::int from del;
$$;

alter table pending_questions enable row level security;
alter table feedback          enable row level security;
alter table reflections       enable row level security;

revoke execute on function archive_stale_facts() from public, anon, authenticated;
revoke execute on function purge_forgotten()     from public, anon, authenticated;
grant  execute on function archive_stale_facts() to service_role;
grant  execute on function purge_forgotten()     to service_role;

create or replace function reinforce_fact(fact_id uuid, episode_id uuid)
returns void language sql
set search_path = public, extensions
as $$
  update facts
     set reinforcements = reinforcements + 1,
         confidence = least(1, confidence + 0.1),
         source_episode_ids = case when episode_id is null then source_episode_ids
                                   else array_append(source_episode_ids, episode_id) end,
         updated_at = now()
   where id = fact_id;
$$;
