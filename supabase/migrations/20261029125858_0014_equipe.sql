-- Migração 0014_equipe (aplicada em 2026-10-29).
-- Exportada do histórico de migrações do Supabase.

create table if not exists public.membros (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  nome text not null,
  papel text not null default 'membro' check (papel in ('admin', 'membro')),
  ativo boolean not null default true,
  convidado_por uuid references auth.users (id),
  ultimo_acesso timestamptz,
  created_at timestamptz not null default now()
);
alter table public.membros enable row level security;

create or replace function public.dono_id() returns uuid
  language sql stable security definer set search_path = public
as $$ select user_id from public.membros where papel = 'admin' and ativo order by created_at limit 1 $$;

do $$
declare t text;
begin
  foreach t in array array['raw_events','episodes','facts','pending_questions','feedback','goals','skills','patterns',
    'reflections','conversation_turns','reminders','notifications','push_subscriptions','recordings','recording_parts',
    'recording_attachments','recording_chunks','localizacoes','oauth_accounts','event_alerts']
  loop
    execute format('alter table public.%I add column if not exists user_id uuid references auth.users (id) on delete cascade default public.dono_id()', t);
    execute format('create index if not exists %I on public.%I (user_id)', t || '_user_idx', t);
  end loop;
end $$;

alter table public.dossies add column if not exists created_by uuid references auth.users (id) on delete set null default public.dono_id();

create or replace function public.match_facts_u(query_embedding vector, match_count integer default 20, min_confidence real default 0.3, p_user uuid default null)
returns table(id uuid, statement text, category text, confidence real, similarity double precision)
language sql stable set search_path to 'public', 'extensions'
as $function$
  select f.id, f.statement, f.category, f.confidence, 1 - (f.embedding <=> query_embedding) as similarity
  from facts f
  where f.status = 'ativo' and f.embedding is not null and f.confidence >= min_confidence
    and (p_user is null or f.user_id = p_user)
  order by f.embedding <=> query_embedding
  limit match_count;
$function$;

create or replace function public.match_episodes_u(query_embedding vector, match_count integer default 10, since timestamptz default null, p_user uuid default null)
returns table(id uuid, summary text, area text, people text[], occurred_at timestamptz, similarity double precision)
language sql stable set search_path to 'public', 'extensions'
as $function$
  select e.id, e.summary, e.area, e.people, e.occurred_at, 1 - (e.embedding <=> query_embedding) as similarity
  from episodes e
  where e.embedding is not null and (since is null or e.occurred_at >= since)
    and (p_user is null or e.user_id = p_user)
  order by e.embedding <=> query_embedding
  limit match_count;
$function$;

create or replace function public.match_recording_chunks_u(query_embedding vector, match_count integer default 12, only_recording uuid default null, p_user uuid default null)
returns table(recording_id uuid, title text, started_at timestamptz, start_s real, content text, similarity double precision)
language sql stable set search_path to 'public', 'extensions'
as $function$
  select c.recording_id, r.title, r.started_at, c.start_s, c.content, 1 - (c.embedding <=> query_embedding) as similarity
  from recording_chunks c join recordings r on r.id = c.recording_id
  where c.embedding is not null and (only_recording is null or c.recording_id = only_recording)
    and (p_user is null or r.user_id = p_user)
  order by c.embedding <=> query_embedding
  limit match_count;
$function$;

create or replace function public.adotar_dados(p_user uuid) returns void
  language plpgsql security definer set search_path = public
as $$
declare t text;
begin
  foreach t in array array['raw_events','episodes','facts','pending_questions','feedback','goals','skills','patterns',
    'reflections','conversation_turns','reminders','notifications','push_subscriptions','recordings','recording_parts',
    'recording_attachments','recording_chunks','localizacoes','oauth_accounts','event_alerts']
  loop
    execute format('update public.%I set user_id = $1 where user_id is null', t) using p_user;
  end loop;
  update public.dossies set created_by = p_user where created_by is null;
end $$;

revoke all on function public.adotar_dados(uuid) from public, anon, authenticated;
revoke all on function public.dono_id() from anon, authenticated;
